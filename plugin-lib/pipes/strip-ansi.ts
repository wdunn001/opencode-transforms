import type { PipeDef } from "../pipeline.ts"

// Terminal colour and cursor codes: meaningless to the model, they cost tokens and hide
// the format from the pipes after it. First in the chain, tool output only.
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g

const pipe: PipeDef = {
  name: "stripAnsi",
  description: "remove terminal colour and cursor escape codes",
  order: 0,
  sources: ["tool"],
  match: /\x1b/,
  matchMode: "text",
  transform: (text) => text.replace(ANSI, ""),
}
export default pipe
