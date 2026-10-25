// Accuracy and latency of the skill pick on labelled prompts, against the live
// decide-gateway and the skills on this machine.
//   node --experimental-strip-types eval/skill-pick.eval.ts [eval/skill-prompts.json]
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join, basename, dirname } from "node:path"
import { accept, allowed, buildIndex, decideRequest, shortlist, stripJsonc, type Skill } from "../plugin-lib/skills.ts"

const DECIDE = (process.env.STRATA_DECIDE_URL ?? "http://127.0.0.1:8889") + "/v1/decide"
const cases: { prompt: string; want: string }[] = JSON.parse(readFileSync(process.argv[2] ?? new URL("skill-prompts.json", import.meta.url), "utf8"))

function walk(d: string, out: string[] = []): string[] {
  if (!existsSync(d)) return out
  for (const f of readdirSync(d)) {
    const p = join(d, f)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (f === "SKILL.md") out.push(p)
  }
  return out
}
const field = (t: string, k: string) => t.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1].trim().replace(/^["']|["']$/g, "")
const rules = JSON.parse(stripJsonc(readFileSync(join(homedir(), ".config/opencode/opencode.jsonc"), "utf8"))).permission?.skill
const byId = new Map<string, Skill>()
for (const root of [join(homedir(), ".claude/skills"), join(homedir(), ".config/opencode/skills")])
  for (const f of walk(root)) {
    const t = readFileSync(f, "utf8"), id = field(t, "name") ?? basename(dirname(f))
    if (allowed(id, rules)) byId.set(id, { id, name: id, description: field(t, "description") ?? "", content: t })
  }
const index = buildIndex([...byId.values()])

let right = 0, falseInj = 0, missed = 0
const ms: number[] = []
for (const c of cases) {
  const picks = shortlist(c.prompt, index).map((h) => h.entry)
  let got = "none", p = 0, t = 0
  if (picks.length) {
    const t0 = Date.now()
    const r = await (await fetch(DECIDE, { method: "POST", body: JSON.stringify(decideRequest(c.prompt, picks, index)) })).json()
    t = Date.now() - t0
    const a = accept(r.probabilities, new Set())
    got = a?.id ?? "none"; p = a?.p ?? r.probabilities[r.choice]
  }
  ms.push(t)
  const ok = got === c.want
  if (ok) right++
  else if (got !== "none") falseInj++
  else missed++
  const inList = c.want === "none" || picks.some((e) => e.id === c.want)
  console.log(`${ok ? "ok  " : "MISS"} ${String(t).padStart(5)}ms opts=${String(picks.length).padStart(2)} ${inList ? " " : "!"} want=${c.want} got=${got} p=${p.toFixed(2)}  ${c.prompt.slice(0, 60)}`)
}
ms.sort((a, b) => a - b)
const q = (f: number) => ms[Math.min(ms.length - 1, Math.floor(ms.length * f))]
console.log(`\n${right}/${cases.length} right (${Math.round((100 * right) / cases.length)}%), ${falseInj} wrong injections, ${missed} missed; skills indexed ${byId.size}; added ms p50 ${q(0.5)} p95 ${q(0.95)}`)
