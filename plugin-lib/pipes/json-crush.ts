import { crush, parses } from "../shared.ts"
import type { PipeDef } from "../pipeline.ts"

// One JSON document: minified, long arrays of same-shaped items shortened (errors kept).
// The regex only checks the shape; confirm parses, so JSON-looking text that is not JSON
// (JSON Lines, a log that starts with "{") falls through to the pipes after it.
const pipe: PipeDef = {
  name: "jsonCrush",
  description: "one JSON document: minify, shorten long arrays of same-shaped items",
  order: 11,
  sources: ["tool", "prompt"],
  match: /^\s*[[{][\s\S]*[\]}]\s*$/,
  matchMode: "text",
  confirm: parses,
  group: "structure",
  transform: (text) => {
    try { return JSON.stringify(crush(JSON.parse(text))) } catch { return text }
  },
}
export default pipe
