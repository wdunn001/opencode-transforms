import { ERROR_LINE } from "../shared.ts"
import type { PipeDef } from "../pipeline.ts"

// Long command output keeps its first and last lines, plus error-looking lines from the
// middle (at most KEEP_ERRORS: the first and last half of them), each gap noted. The
// output always stays under MIN_LINES, so a second pass changes nothing. Last in the
// chain; never on prompts (the user's own words are not cut).
const HEAD_LINES = 150
const TAIL_LINES = 150
export const MIN_LINES = 400
const KEEP_ERRORS = 48

const pipe: PipeDef = {
  name: "headTail",
  description: "long output: keep the first and last lines and the error lines between",
  order: 40,
  sources: ["tool"],
  match: /\n/,
  matchMode: "text",
  transform: (text) => {
    const lines = text.split("\n")
    if (lines.length <= MIN_LINES) return text
    const mid = lines.slice(HEAD_LINES, lines.length - TAIL_LINES)
    let keep = mid.map((l, i) => (ERROR_LINE.test(l) ? i : -1)).filter((i) => i >= 0)
    if (keep.length > KEEP_ERRORS) keep = [...keep.slice(0, KEEP_ERRORS / 2), ...keep.slice(-KEEP_ERRORS / 2)]
    const out = lines.slice(0, HEAD_LINES)
    let at = 0
    for (const i of [...keep, mid.length]) {
      if (i > at) out.push(`[... ${i - at} lines omitted ...]`)
      if (i < mid.length) out.push(mid[i])
      at = i + 1
    }
    return [...out, ...lines.slice(-TAIL_LINES)].join("\n")
  },
}
export default pipe
