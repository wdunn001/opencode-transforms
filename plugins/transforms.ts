// Transform content once, as it enters opencode's context (opencode 2.x plugin format).
//
// Two entry points, each seeing only what is new:
//   tool.execute.after  a tool response (built-in or MCP), before opencode stores it
//   session.prompt      a new user prompt, before it is stored
// opencode then stores and resends the transformed version itself, so nothing is
// evaluated again on later requests and nothing rewrites the outgoing prompt.
//
// The cursor: per session, the IDs already evaluated plus a sequence number. An ID the
// cursor has seen is skipped, so a repeated hook call can never evaluate twice.
//
// The work itself is ../plugin-lib/: one PipeDef per file in pipes/, loaded once at setup
// into one array (loadPipes), run in order by pipeline.ts (pure, regex-first).
//   STRATA_TRANSFORMS=0          turns this plugin off
//   STRATA_PIPES_OFF=a,b         turns single pipes off by name (see plugin-lib/pipes/)
//   STRATA_TRANSFORMS_LOG=path   appends one line per evaluation (sizes, matched and changing pipes; never content)
import { appendFileSync } from "node:fs"
import { loadPipes, run, type Ctx, type PipeDef } from "../plugin-lib/pipeline.ts"

const OFF = process.env.STRATA_TRANSFORMS === "0"
const PIPES_OFF: ReadonlySet<string> = new Set((process.env.STRATA_PIPES_OFF ?? "").split(",").map((s) => s.trim()).filter(Boolean))
const LOG = process.env.STRATA_TRANSFORMS_LOG

type Cursor = { seq: number; lastMessageID?: string; lastCallID?: string; seen: Set<string> }
const SEEN_MAX = 4096
const cursors = new Map<string, Cursor>()

// true when `id` is new for this session (and records it), false when already evaluated
function advance(sessionID: string, id: string): Cursor | undefined {
  let c = cursors.get(sessionID)
  if (c === undefined) { c = { seq: 0, seen: new Set() }; cursors.set(sessionID, c) }
  if (c.seen.has(id)) return undefined
  c.seen.add(id)
  if (c.seen.size > SEEN_MAX) c.seen.delete(c.seen.values().next().value as string)
  c.seq++
  return c
}

function note(kind: string, sessionID: string, seq: number, before: number, after: number, matched: string[], pipes: string[]) {
  if (!LOG || matched.length === 0) return
  try { appendFileSync(LOG, JSON.stringify({ kind, sessionID, seq, before, after, matched, pipes }) + "\n") } catch { /* logging never breaks a tool call */ }
}

export default {
  id: "strata-transforms",
  setup: async (ctx: any) => {
    if (OFF) return
    const pipes: PipeDef[] = await loadPipes()        // once, at init
    ctx.tool.hook("execute.after", (ev: any) => {
      if (ev?.status !== "completed" || !Array.isArray(ev.result?.content)) return ev
      const cur = advance(ev.sessionID, `call:${ev.id}`)
      if (cur === undefined) return ev
      cur.lastCallID = ev.id
      const c: Ctx = { source: "tool", tool: ev.tool }
      // The same text can sit in content[] and in the structured output: evaluate each
      // distinct text once and reuse the result.
      const done = new Map<string, string>()
      const once = (text: string): string => {
        let out = done.get(text)
        if (out === undefined) {
          const r = run(text, c, pipes, PIPES_OFF)
          out = r.text
          done.set(text, out)
          note("tool", ev.sessionID, cur.seq, text.length, out.length, r.matched, r.pipes)
        }
        return out
      }
      ev.result.content = ev.result.content.map((p: any) => (p?.type === "text" && typeof p.text === "string" ? { ...p, text: once(p.text) } : p))
      const o = ev.result.output
      if (o && typeof o === "object" && typeof o.output === "string") ev.result.output = { ...o, output: once(o.output) }
      return ev
    })
    ctx.session.hook("prompt", (ev: any) => {
      if (typeof ev?.prompt?.text !== "string") return ev
      const cur = advance(ev.sessionID, `msg:${ev.messageID}`)
      if (cur === undefined) return ev
      cur.lastMessageID = ev.messageID
      const r = run(ev.prompt.text, { source: "prompt" }, pipes, PIPES_OFF)
      note("prompt", ev.sessionID, cur.seq, ev.prompt.text.length, r.text.length, r.matched, r.pipes)
      ev.prompt.text = r.text
      return ev
    })
  },
}
