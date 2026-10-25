import { collapseRuns } from "../shared.ts"
import type { PipeDef } from "../pipeline.ts"

// Runs of 3 or more identical lines become the line, a note, and the line again.
const pipe: PipeDef = {
  name: "dedupeLines",
  description: "collapse runs of identical lines",
  order: 30,
  sources: ["tool", "prompt"],
  match: /^(.*)\n\1\n\1$/m,
  matchMode: "text",
  transform: (text) => collapseRuns(text.split("\n"), (a, b) => a === b, (n) => `[... the line above repeated ${n} more times ...]`).join("\n"),
}
export default pipe
