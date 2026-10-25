import { JSONL_LINE, crush, parses } from "../shared.ts"
import { NOTE, sampledLines, type PipeDef } from "../pipeline.ts"

// JSON Lines (one document per line: docker, journalctl -o json, structured app logs):
// each record minified and crushed on its own, so it stays JSON Lines. logCollapse,
// later in the chain, collapses runs of records that differ only in values.
const pipe: PipeDef = {
  name: "jsonlCrush",
  description: "JSON Lines: minify and crush each record",
  order: 10,
  sources: ["tool", "prompt"],
  match: JSONL_LINE,
  matchMode: "lines",
  minShare: 0.8,
  confirm: (text) => sampledLines(text).every(parses),
  group: "structure",
  transform: (text) => text.split("\n").map((line) => {
    const t = line.trim()
    if (t === "" || NOTE.test(t)) return line
    try { return JSON.stringify(crush(JSON.parse(t))) } catch { return line }
  }).join("\n"),
}
export default pipe
