// Detection benchmark for config-linux/plugin-lib: regex-first vs parse-first.
//   node --experimental-strip-types bench/pipebench.ts <corpus.jsonl>
// corpus.jsonl: one {"tool": name, "text": tool output} per line (exported read-only from
// ~/.local/share/opencode/opencode.db). Prints statistics only, never the content.
import { readFileSync } from "node:fs"
import { MIN_CHARS, PROTECTED_TOOLS, loadPipes, matches, run, sampledLines, type PipeDef } from "../plugin-lib/pipeline.ts"

const PIPES = await loadPipes()
const P: Record<string, PipeDef> = Object.fromEntries(PIPES.map((p) => [p.name, p]))
type Row = { tool: string; text: string }
const rows: Row[] = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l))
const big = rows.filter((r) => r.text.length >= MIN_CHARS && !PROTECTED_TOOLS.has(r.tool))
const parses = (t: string) => { try { JSON.parse(t); return true } catch { return false } }

// The shape each method picks for a text: jsonl / json / log / text.
const STRUCTURE = PIPES.filter((p) => p.group === "structure")
const label = (name: string) => (name === "jsonlCrush" ? "jsonl" : "json")
function regexFirst(t: string): string {        // as shipped: each pipe's regex, confirm only after a regex hit
  const s = STRUCTURE.find((p) => matches(p, t))
  return s ? label(s.name) : matches(P.logCollapse, t) ? "log" : "text"
}
function regexOnly(t: string): string {         // the regexes without confirm: fastest, can misfire
  const s = STRUCTURE.find((p) => matches({ ...p, confirm: undefined }, t))
  return s ? label(s.name) : matches(P.logCollapse, t) ? "log" : "text"
}
function parseFirst(t: string): string {        // try parsing first, regex only for logs
  if (parses(t)) return "json"
  const lines = sampledLines(t)
  if (lines.length >= 3 && lines.every(parses)) return "jsonl"
  return matches(P.logCollapse, t) ? "log" : "text"
}
const truth = (t: string) => (parses(t) ? "json" : (() => { const l = sampledLines(t); return l.length >= 3 && l.every(parses) })() ? "jsonl" : "other")

function timeNs(fn: (t: string) => unknown, texts: string[], reps: number): number {
  for (const t of texts) fn(t)                            // warm up
  const t0 = process.hrtime.bigint()
  for (let r = 0; r < reps; r++) for (const t of texts) fn(t)
  return Number(process.hrtime.bigint() - t0) / (reps * texts.length)
}

const texts = big.map((r) => P.stripAnsi.transform(r.text, { source: "tool" }))
console.log(`corpus: ${rows.length} tool results, ${big.length} over ${MIN_CHARS} chars and not protected; pipes: ${PIPES.map((p) => p.name).join(" > ")}`)
for (const [name, fn] of [["regex-only", regexOnly], ["regex-first", regexFirst], ["parse-first", parseFirst]] as const) {
  const picks = new Map<string, number>()
  let wrong = 0
  for (const t of texts) {
    const p = fn(t)
    picks.set(p, (picks.get(p) ?? 0) + 1)
    const tr = truth(t)
    if ((p === "json" || p === "jsonl" || tr !== "other") && p !== tr) wrong++
  }
  console.log(`${name.padEnd(12)} ${timeNs(fn, texts, 200).toFixed(0).padStart(8)} ns/payload  picks ${JSON.stringify(Object.fromEntries(picks))}  wrong structure picks ${wrong}`)
}

let before = 0, after = 0
const used = new Map<string, number>()
for (const r of big) {
  const res = run(r.text, { source: "tool", tool: r.tool }, PIPES)
  before += r.text.length; after += res.text.length
  for (const n of res.pipes) used.set(n, (used.get(n) ?? 0) + 1)
}
const pipeNs = timeNs((t) => run(t, { source: "tool", tool: "shell" }, PIPES), texts, 20)
console.log(`pipeline: ${(pipeNs / 1e6).toFixed(2)} ms/payload, ${before} -> ${after} chars (${(100 * (1 - after / before)).toFixed(1)}% smaller, ~${Math.round((before - after) / 4)} tokens)`)
console.log(`pipes that changed something: ${JSON.stringify(Object.fromEntries(used))}`)
