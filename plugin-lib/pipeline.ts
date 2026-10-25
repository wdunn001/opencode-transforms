// Pure transforms for content entering opencode's context (see ../plugins/transforms.ts).
//
// Every pipe lives in its own file in ./pipes/ and implements PipeDef: its name, what it
// is for, where it sits in the chain, what it applies to, the regex that says whether it
// matches, an optional confirm step, and its pure transform. loadPipes() imports them all
// once at init into one array, sorted by order. run() walks that array like an Angular
// pipe chain: each pipe whose regex (then confirm) matches transforms the text and hands
// it to the next.
//
// Every transform is pure (no I/O, no clock, no randomness) and idempotent (running it on
// its own output changes nothing). Anything omitted is said in plain text in the output.
//
// No opencode imports: this runs under plain Node for the tests and the benchmark.
import { readdirSync } from "node:fs"

export type Source = "tool" | "prompt"
export type Ctx = { source: Source; tool?: string }

export interface PipeDef {
  /** unique; what STRATA_PIPES_OFF names */
  name: string
  /** one line: what it does */
  description: string
  /** position in the chain, low first */
  order: number
  /** which entry points it runs on */
  sources: readonly Source[]
  /** the regex-first gate */
  match: RegExp
  /** "text": the regex is tested on the whole text; "lines": on sampled lines, and at
   *  least minShare of them must match */
  matchMode: "text" | "lines"
  minShare?: number
  /** runs only when match passed: the exact (slower) check, e.g. a JSON parse */
  confirm?: (text: string) => boolean
  /** pipes sharing a group are alternatives: only the first one that matches runs */
  group?: string
  transform: (text: string, ctx: Ctx) => string
}

/** matched: the pipes whose regex and confirm passed; pipes: the ones that changed the text */
export type Result = { text: string; gate: "small" | "protected" | "ran"; matched: string[]; pipes: string[] }

// ~2K tokens at ~4 characters a token: smaller outputs are not worth touching.
export const MIN_CHARS = 8000
// The model edits exact text from these: never transform their results.
export const PROTECTED_TOOLS = new Set(["read", "edit", "write", "patch", "multiedit", "apply_patch"])
// How many non-empty lines a "lines" pipe samples.
export const SAMPLE_LINES = 40
// The pipeline's own note lines ("[... 12 similar lines omitted ...]"): never content.
export const NOTE = /^\[\.\.\. .* \.\.\.\]$/

export function sampledLines(text: string, limit?: number): string[] {
  return text.split("\n", limit).filter((l) => l.trim() !== "" && !NOTE.test(l.trim()))
}

/** regex gate then confirm: does this pipe apply to this text? */
export function matches(p: PipeDef, text: string): boolean {
  let hit: boolean
  if (p.matchMode === "text") hit = p.match.test(text)
  else {
    const lines = sampledLines(text, SAMPLE_LINES)
    hit = lines.length >= 3 && lines.filter((l) => p.match.test(l)).length / lines.length >= (p.minShare ?? 0.5)
  }
  return hit && (p.confirm === undefined || p.confirm(text))
}

function validate(p: unknown, file: string): PipeDef {
  const d = p as PipeDef
  const ok = d && typeof d.name === "string" && typeof d.description === "string" && typeof d.order === "number" &&
    Array.isArray(d.sources) && d.match instanceof RegExp && !d.match.global && (d.matchMode === "text" || d.matchMode === "lines") &&
    typeof d.transform === "function" && (d.confirm === undefined || typeof d.confirm === "function")
  if (!ok) throw new Error(`pipe ${file} does not implement PipeDef (name, description, order, sources, match without /g, matchMode, transform)`)
  return d
}

/** Import every pipe in dir (default ./pipes/) once, check it, and return them sorted. */
export async function loadPipes(dir: URL = new URL("./pipes/", import.meta.url)): Promise<PipeDef[]> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts")).sort()
  const pipes: PipeDef[] = []
  for (const f of files) pipes.push(validate((await import(new URL(f, dir).href)).default, f))
  const names = new Set<string>()
  for (const p of pipes) {
    if (names.has(p.name)) throw new Error(`two pipes are named ${p.name}`)
    names.add(p.name)
  }
  return pipes.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))
}

/** The chain: gates, then each pipe in order whose source, regex and confirm match. */
export function run(text: string, ctx: Ctx, pipes: readonly PipeDef[], off: ReadonlySet<string> = new Set()): Result {
  if (text.length < MIN_CHARS) return { text, gate: "small", matched: [], pipes: [] }
  if (ctx.source === "tool" && ctx.tool !== undefined && PROTECTED_TOOLS.has(ctx.tool)) return { text, gate: "protected", matched: [], pipes: [] }
  let out = text
  const used: string[] = []
  const matched: string[] = []
  const groupsDone = new Set<string>()
  for (const p of pipes) {
    if (off.has(p.name) || !p.sources.includes(ctx.source)) continue
    if (p.group !== undefined && groupsDone.has(p.group)) continue
    if (!matches(p, out)) continue
    if (p.group !== undefined) groupsDone.add(p.group)
    matched.push(p.name)
    const next = p.transform(out, ctx)
    if (next !== out) used.push(p.name)
    out = next
  }
  return { text: out, gate: "ran", matched, pipes: used }
}
