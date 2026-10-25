// Load the right skill before the turn starts, instead of listing every skill in every
// request (opencode 2.x plugin format).
//
//   setup            takes the user skills out of opencode's skill registry (the list in
//                    the system prompt is built from it) and keeps them in an index here.
//                    The built-in opencode skills stay listed.
//   session.prompt   once per NEW prompt: keyword shortlist (pure, ../plugin-lib/skills.ts);
//                    nothing scores = no decision. Otherwise one /v1/decide call (the
//                    model's next-token choice over the shortlist + "none"); a pick at
//                    p >= 0.6 appends that skill as a <skill_content> block, once per session.
//   skill_find/skill_load   tools for a need that shows up mid-task.
//
//   STRATA_SKILL_PICK=0          turns the per-prompt pick off (skills stay out of the
//                                list and remain reachable through skill_find/skill_load)
//   STRATA_DECIDE_URL=url        decide-gateway (default http://127.0.0.1:8889)
//   STRATA_TRANSFORMS_LOG=path   one line per decision (chosen id, probability, ms; never content)
import { appendFileSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { accept, allowed, buildIndex, decideRequest, injection, shortlist, stripJsonc, type Index, type Skill } from "../plugin-lib/skills.ts"

const PICK = process.env.STRATA_SKILL_PICK !== "0"
const DECIDE = (process.env.STRATA_DECIDE_URL ?? "http://127.0.0.1:8889") + "/v1/decide"
const DECIDE_TIMEOUT_MS = 2500
const LOG = process.env.STRATA_TRANSFORMS_LOG
const BUILTIN = new Set(["opencode", "report"])

type State = { seen: Set<string>; injected: Set<string> }
const sessions = new Map<string, State>()

function skillRules(): Record<string, string> | undefined {
  const dir = process.env.OPENCODE_CONFIG_DIR ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "opencode")
  for (const f of ["opencode.jsonc", "opencode.json"]) {
    try { return JSON.parse(stripJsonc(readFileSync(join(dir, f), "utf8"))).permission?.skill } catch { /* next */ }
  }
  return undefined
}

function note(o: Record<string, unknown>) {
  if (!LOG) return
  try { appendFileSync(LOG, JSON.stringify({ kind: "skill", ...o }) + "\n") } catch { /* logging never breaks a prompt */ }
}

export default {
  id: "skill-pick",
  setup: async (ctx: any) => {
    let index: Index = buildIndex([])
    const byId = new Map<string, Skill>()
    const rules = skillRules()

    // The file-based skills are added by transforms registered after the plugins' setup,
    // and a transform runs in registration order. So wait until the registry lists them,
    // then register (this one runs last) and reload once.
    const takeOver = async () => {
      for (let i = 0; i < 300; i++) {
        const r = await ctx.skill.list()                      // { location, data: Skill[] }
        const listed = Array.isArray(r) ? r : r?.data
        if (Array.isArray(listed) && listed.some((s: any) => !BUILTIN.has(s.id))) break
        await new Promise((r) => setTimeout(r, 100))
      }
      await ctx.skill.transform((ed: any) => {
        const user: Skill[] = []
        for (const s of ed.list()) {
          if (BUILTIN.has(s.id)) continue
          ed.remove(s.id)
          if (allowed(s.id, rules)) user.push({ id: s.id, name: s.name ?? s.id, description: s.description ?? "", content: String(s.content ?? "") })
        }
        if (user.length) {
          index = buildIndex(user)
          byId.clear()
          for (const s of user) byId.set(s.id, s)
        }
      })
      await ctx.skill.reload()
      // Fill the engine's cache with the catalog now, so the first real prompt does not
      // pay for reading it (~5 s); later decisions re-read only the prompt.
      if (PICK && index.entries.length > 1)
        fetch(DECIDE, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(decideRequest("warm up", index.entries.slice(0, 1), index)), signal: AbortSignal.timeout(30_000) }).catch(() => {})
    }
    const ready = takeOver().catch((e) => note({ error: `skill takeover: ${e?.message ?? e}` }))

    await ctx.tool.transform((ed: any) => {
      ed.add({
        name: "skill_find",
        options: { codemode: false },
        description: "Find skills (task instructions for this lab) by what you are about to do. Returns up to 5 names with descriptions; load one with skill_load.",
        input: { type: "object", properties: { query: { type: "string", description: "The task, in a few words." } }, required: ["query"], additionalProperties: false },
        async execute(a: { query: string }) {
          const hits = shortlist(a.query, index, 5, 0.01)
          return { content: hits.length ? hits.map((h) => `${h.entry.id}: ${h.entry.description.slice(0, 200)}`).join("\n") : "No matching skill." }
        },
      })
      ed.add({
        name: "skill_load",
        options: { codemode: false },
        description: "Load a skill's full instructions by name (from skill_find, or named in a <skill_content> block).",
        input: { type: "object", properties: { name: { type: "string", description: "Skill name." } }, required: ["name"], additionalProperties: false },
        async execute(a: { name: string }) {
          const s = byId.get(a.name)
          return { content: s ? s.content : `No skill named "${a.name}". Use skill_find.` }
        },
      })
    })

    if (!PICK) return
    ctx.session.hook("prompt", async (ev: any) => {
      if (typeof ev?.prompt?.text !== "string") return ev
      let st = sessions.get(ev.sessionID)
      if (st === undefined) { st = { seen: new Set(), injected: new Set() }; sessions.set(ev.sessionID, st) }
      const key = `msg:${ev.messageID}`
      if (st.seen.has(key)) return ev
      st.seen.add(key)

      // a prompt that arrives at startup waits for the index (bounded)
      await Promise.race([ready, new Promise((r) => setTimeout(r, 3000))])
      const picks = shortlist(ev.prompt.text, index).map((h) => h.entry).filter((e) => !st.injected.has(e.id))
      if (picks.length === 0) { note({ sessionID: ev.sessionID, options: 0, indexed: index.entries.length }); return ev }
      const t0 = Date.now()
      try {
        const res = await fetch(DECIDE, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(decideRequest(ev.prompt.text, picks, index)),
          signal: AbortSignal.timeout(DECIDE_TIMEOUT_MS),
        })
        const r = await res.json()
        const got = accept(r.probabilities ?? {}, st.injected)
        note({ sessionID: ev.sessionID, options: picks.length, choice: r.choice, p: got?.p ?? r.probabilities?.[r.choice], injected: got?.id ?? null, ms: Date.now() - t0 })
        if (got) {
          st.injected.add(got.id)
          ev.prompt.text += injection(byId.get(got.id)!)
        }
      } catch (e: any) {
        note({ sessionID: ev.sessionID, options: picks.length, error: String(e?.name ?? e), ms: Date.now() - t0 })
      }
      return ev
    })
  },
}
