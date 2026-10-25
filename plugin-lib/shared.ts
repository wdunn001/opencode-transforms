// Helpers the pipes in ./pipes/ share. Pure functions only.

// ---------------------------------------------------------------- JSON
// Long arrays of same-shaped objects keep their first 3 and last 2 items plus every item
// that mentions an error, with a note saying how many were left out.
const ARRAY_KEEP_HEAD = 3
const ARRAY_KEEP_TAIL = 2
const ARRAY_MIN = 8
const ERRORISH = /error|fail|exception|fatal|denied|refused|timeout/i

function shapeOf(v: unknown): string | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null
  return Object.keys(v as object).sort().join(",")
}

export function crush(v: unknown): unknown {
  if (Array.isArray(v)) {
    const items = v.map(crush)
    const shape = items.length >= ARRAY_MIN ? shapeOf(items[0]) : null
    if (shape === null || !items.every((it) => shapeOf(it) === shape)) return items
    const keep = new Set<number>()
    for (let i = 0; i < ARRAY_KEEP_HEAD; i++) keep.add(i)
    for (let i = items.length - ARRAY_KEEP_TAIL; i < items.length; i++) keep.add(i)
    items.forEach((it, i) => { if (ERRORISH.test(JSON.stringify(it))) keep.add(i) })
    const left = items.length - keep.size
    if (left <= 0) return items
    const out: unknown[] = []
    let noted = false
    items.forEach((it, i) => {
      if (keep.has(i)) out.push(it)
      else if (!noted) { out.push(`[... ${left} similar items omitted ...]`); noted = true }
    })
    return out
  }
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = crush(x)
    return out
  }
  return v
}

export function parses(text: string): boolean {
  try { JSON.parse(text); return true } catch { return false }
}

// ---------------------------------------------------------------- lines
// Timestamps, ids and numbers become placeholders, so log lines that differ only in
// those compare equal.
const TS = /\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?|\b[A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2}/g
// ids: 8+ hex characters with at least one letter (plain numbers go to NUM)
const HEX = /\b(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi
const NUM = /\d+(?:\.\d+)?/g

export function normalise(line: string): string {
  return line.replace(TS, "<ts>").replace(HEX, "<id>").replace(NUM, "<n>")
}

/** Runs of 3 or more consecutive lines that are `same` become first line, note, last line. */
export function collapseRuns(lines: string[], same: (a: string, b: string) => boolean, note: (n: number) => string): string[] {
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    let j = i + 1
    while (j < lines.length && same(lines[i], lines[j])) j++
    const run = j - i
    if (run >= 3) out.push(lines[i], note(run - 2), lines[j - 1])
    else for (let k = i; k < j; k++) out.push(lines[k])
    i = j
  }
  return out
}

export const ERROR_LINE = /\b(?:error|fatal|panic|exception|traceback|fail(?:ed|ure)?|critical)\b/i
// One log line: an ISO or slash timestamp, a syslog timestamp, or a level word first.
export const LOG_LINE = /^(?:\S+\s+)?\[?\d{4}[-/]\d{2}[-/]\d{2}[T ]\d{2}:\d{2}|^[A-Z][a-z]{2} [ \d]\d \d{2}:\d{2}:\d{2}|^\s*(?:\[\s*)?(?:TRACE|DEBUG|INFO|NOTICE|WARN(?:ING)?|ERROR|FATAL|CRIT(?:ICAL)?)\b/i
// One JSON Lines record.
export const JSONL_LINE = /^\s*\{.*\}\s*$/
