// node --experimental-strip-types --test config-linux/plugin-lib/pipeline.test.ts
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { MIN_CHARS, loadPipes, matches, run, type PipeDef } from "./pipeline.ts"
import { MIN_LINES } from "./pipes/head-tail.ts"

const PIPES = await loadPipes()
const P: Record<string, PipeDef> = Object.fromEntries(PIPES.map((p) => [p.name, p]))
const tool = { source: "tool" as const, tool: "shell" }
const prompt = { source: "prompt" as const }

function bigLog(n: number): string {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const s = String(i % 60).padStart(2, "0")
    out.push(`2026-10-24T12:00:${s}.${String(i).padStart(3, "0")}Z INFO worker-${i % 3} handled request id=${(0xabcdef00 + i).toString(16)} in ${i % 97}ms`)
    if (i % 250 === 0) out.push(`2026-10-24T12:00:${s}Z ERROR worker-1 upstream refused connection to 10.0.0.${i % 255}`)
  }
  return out.join("\n")
}
function bigJson(n: number): string {
  const items = Array.from({ length: n }, (_, i) => ({ id: i, name: `svc-${i}`, status: i === 7 ? "error: timeout" : "ok", port: 8000 + i }))
  return JSON.stringify({ count: n, items }, null, 2)
}
function bigJsonl(n: number): string {
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    out.push(JSON.stringify({ level: "info", ts: 1792898000 + i * 0.25, msg: "request handled", req: { id: (0xbeef0000 + i).toString(16), path: `/api/items/${i}`, ms: i % 97 } }))
    if (i % 100 === 0) out.push(JSON.stringify({ level: "error", ts: 1792898000 + i * 0.25, msg: "upstream refused connection", peer: `10.0.0.${i % 255}` }))
  }
  return out.join("\n")
}
const corpus = [bigLog(2000), bigJson(400), bigJsonl(1500), Array(900).fill("same line").join("\n"), bigLog(30), "x".repeat(MIN_CHARS + 10)]

test("registry: every pipe implements PipeDef, names unique, loaded once in chain order", () => {
  assert.deepEqual(PIPES.map((p) => p.name), ["stripAnsi", "jsonlCrush", "jsonCrush", "logCollapse", "dedupeLines", "headTail"])
  for (const p of PIPES) {
    assert.ok(p.description.length > 0 && p.sources.length > 0 && p.match instanceof RegExp, p.name)
  }
})

test("registry: a file that is not a PipeDef is rejected at init", async () => {
  const dir = mkdtempSync(join(tmpdir(), "pipes-"))
  writeFileSync(join(dir, "bad.ts"), "export default { name: 'bad' }\n")
  await assert.rejects(loadPipes(pathToFileURL(dir + "/")), /does not implement PipeDef/)
})

test("pure: the same input gives identical bytes twice", () => {
  for (const t of corpus) for (const ctx of [tool, prompt]) assert.equal(run(t, ctx, PIPES).text, run(t, ctx, PIPES).text)
})

test("idempotent: running on its own output changes nothing", () => {
  for (const t of corpus) for (const ctx of [tool, prompt]) {
    const once = run(t, ctx, PIPES).text
    assert.equal(run(once, ctx, PIPES).text, once)
  }
  for (const p of PIPES) for (const t of corpus) { const once = p.transform(t, tool); assert.equal(p.transform(once, tool), once, p.name) }
})

test("gates: small output and protected tools pass through untouched", () => {
  const small = "line\n".repeat(100)
  assert.deepEqual(run(small, tool, PIPES), { text: small, gate: "small", matched: [], pipes: [] })
  const big = bigLog(2000)
  for (const t of ["read", "edit", "write", "patch"]) assert.equal(run(big, { source: "tool", tool: t }, PIPES).text, big)
})

test("each pipe's regex (and confirm) picks the right content", () => {
  assert.ok(matches(P.jsonCrush, bigJson(50)) && !matches(P.jsonlCrush, bigJson(50)))   // pretty JSON is not JSON Lines
  assert.ok(matches(P.jsonlCrush, bigJsonl(50)) && !matches(P.jsonCrush, bigJsonl(50))) // JSON Lines is not one document
  assert.ok(matches(P.logCollapse, bigLog(50)) && matches(P.logCollapse, bigJsonl(50)))
  assert.ok(!matches(P.logCollapse, "plain words here\n".repeat(50)))
  assert.ok(!matches(P.logCollapse, "a\nb\nc\nd\ne\nf"))
  assert.ok(!matches(P.stripAnsi, "no escapes"))
})

test("structure group: only one of jsonlCrush / jsonCrush runs", () => {
  assert.deepEqual(run(bigJsonl(1500), tool, PIPES).matched.filter((n) => n.endsWith("Crush")), ["jsonlCrush"])
  assert.deepEqual(run(bigJson(400), tool, PIPES).matched.filter((n) => n.endsWith("Crush")), ["jsonCrush"])
})

test("jsonl: every record line stays valid JSON, error records kept, runs collapsed", () => {
  const j = bigJsonl(1500)
  const r = run(j, tool, PIPES)
  for (const l of r.text.split("\n")) if (!l.startsWith("[... ")) JSON.parse(l)
  const errs = (s: string) => s.split("\n").filter((l) => l.includes('"level":"error"')).length
  assert.equal(errs(r.text), errs(j))
  assert.ok(r.text.length < j.length / 10)
  assert.ok(matches(P.jsonlCrush, r.text))                       // still JSON Lines after its own notes
  const rec = JSON.stringify({ items: Array.from({ length: 20 }, (_, i) => ({ id: i, ok: true })) })
  assert.ok(JSON.parse(P.jsonlCrush.transform(rec, tool)).items.includes("[... 15 similar items omitted ...]"))
  assert.equal(P.jsonlCrush.transform("{broken", tool), "{broken")
})

test("jsonCrush keeps head, tail and error items, notes the rest, stays valid JSON", () => {
  const out = JSON.parse(P.jsonCrush.transform(bigJson(400), tool))
  assert.equal(out.count, 400)
  const ids = out.items.filter((x: unknown) => typeof x === "object").map((x: { id: number }) => x.id)
  assert.deepEqual(ids, [0, 1, 2, 7, 398, 399])
  assert.ok(out.items.includes("[... 394 similar items omitted ...]"))
  assert.equal(P.jsonCrush.transform("{not json", tool), "{not json")
})

test("logCollapse keeps error lines and states how many it dropped", () => {
  const log = bigLog(2000)
  const out = P.logCollapse.transform(log, tool)
  const errors = (s: string) => s.split("\n").filter((l) => l.includes("ERROR")).length
  assert.equal(errors(out), errors(log))
  assert.match(out, /\[\.\.\. \d+ similar lines omitted \.\.\.\]/)
  assert.ok(out.length < log.length / 10)
})

test("dedupeLines and headTail", () => {
  assert.equal(P.dedupeLines.transform("a\nb\nb\nb\nb\nc", tool), "a\nb\n[... the line above repeated 2 more times ...]\nb\nc")
  const many = Array.from({ length: MIN_LINES + 100 }, (_, i) => `line ${i}`).join("\n")
  const out = P.headTail.transform(many, tool).split("\n")
  assert.equal(out[0], "line 0")
  assert.equal(out.at(-1), `line ${MIN_LINES + 99}`)
  assert.ok(out.includes("[... 200 lines omitted ...]"))
})

test("headTail keeps error lines from the middle, capped, and stays idempotent", () => {
  const text = Array.from({ length: 3000 }, (_, i) => (i % 25 === 0 && i > 200 && i < 2800 ? `step ${i} FAILED: exit 1` : `step ${i} ok`)).join("\n")
  const out = P.headTail.transform(text, tool)
  assert.equal(out.split("\n").filter((l) => l.includes("FAILED")).length, 48)
  assert.ok(out.split("\n").length <= MIN_LINES)
  assert.equal(P.headTail.transform(out, tool), out)
  const few = Array.from({ length: 1000 }, (_, i) => (i === 500 ? "ERROR disk full" : `line ${i}`)).join("\n")
  assert.ok(P.headTail.transform(few, tool).includes("ERROR disk full"))
})

test("stripAnsi runs first on tool output, not on prompts", () => {
  const coloured = Array.from({ length: 400 }, (_, i) => `\x1b[32mok\x1b[0m step ${i} \x1b[1mdone\x1b[0m`).join("\n")
  const t = run(coloured, tool, PIPES)
  assert.ok(!t.text.includes("\x1b") && t.pipes[0] === "stripAnsi")
  assert.ok(run(coloured, prompt, PIPES).text.includes("\x1b"))
})

test("JSON-shaped text that does not parse falls through to the pipes after it", () => {
  const fake = "{\n" + Array(900).fill("not really json line").join("\n") + "\n}"
  const r = run(fake, tool, PIPES)
  assert.ok(!r.pipes.includes("jsonCrush") && r.pipes.includes("dedupeLines"))
})

test("prompts are never cut by headTail", () => {
  const many = Array.from({ length: 2000 }, (_, i) => `my note number ${i} about the design`).join("\n")
  assert.equal(run(many, prompt, PIPES).text, many)
  assert.notEqual(run(many, tool, PIPES).text, many)
})

test("switching a pipe off skips it", () => {
  const log = bigLog(2000)
  assert.equal(run(log, tool, PIPES, new Set(["logCollapse", "dedupeLines", "headTail"])).text, log)
})
