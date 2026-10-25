import { LOG_LINE, JSONL_LINE, collapseRuns, normalise } from "../shared.ts"
import type { PipeDef } from "../pipeline.ts"

// Runs of 3 or more consecutive lines that differ only in timestamps, numbers and ids
// become the first line, a note, and the last line. Error lines differ from their
// neighbours, so they are never inside a run. Logs and JSON Lines only.
const pipe: PipeDef = {
  name: "logCollapse",
  description: "collapse runs of log lines that differ only in timestamps, ids and numbers",
  order: 20,
  sources: ["tool", "prompt"],
  match: new RegExp(`${LOG_LINE.source}|${JSONL_LINE.source}`, "i"),
  matchMode: "lines",
  minShare: 0.5,
  transform: (text) => collapseRuns(text.split("\n"), (a, b) => normalise(a) === normalise(b), (n) => `[... ${n} similar lines omitted ...]`).join("\n"),
}
export default pipe
