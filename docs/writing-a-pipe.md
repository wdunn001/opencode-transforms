# Writing a pipe

A pipe is one file in `plugin-lib/pipes/` whose default export implements `PipeDef`
(defined in `plugin-lib/pipeline.ts`):

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | unique; what `STRATA_PIPES_OFF` names |
| `description` | yes | one line: what it does |
| `order` | yes | position in the chain, lowest first |
| `sources` | yes | `["tool"]`, `["prompt"]` or both |
| `match` | yes | a RegExp without the `g` flag: the cheap test |
| `matchMode` | yes | `"text"` tests the whole text, `"lines"` tests sampled lines |
| `minShare` | no | for `"lines"`: the share of sampled lines that must match (default 0.5) |
| `confirm` | no | runs only after `match` passed: an exact, slower check |
| `group` | no | pipes in one group are alternatives: only the first match runs |
| `transform` | yes | `(text, ctx) => string`, pure and idempotent |

`ctx` is `{ source: "tool" | "prompt", tool?: string }`.

## Example

`dedupe-lines.ts`, the whole file:

```ts
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
```

## Rules

- Pure: no file or network access, no clock, no randomness. The same input always gives the
  same bytes, which keeps the stored history and the model's prompt cache stable.
- Idempotent: `transform(transform(x)) === transform(x)`.
- Say what was left out, in a note line of the form `[... what was omitted ...]`. The
  pipeline recognises that form and does not sample it as content.
- Keep `match` cheap; put anything expensive, like a parse, in `confirm`.
- Shared helpers (`collapseRuns`, `normalise`, `crush`, `ERROR_LINE`, `LOG_LINE`) are in
  `plugin-lib/shared.ts`.

Add a test to `plugin-lib/pipeline.test.ts`, run the tests, and reinstall. A new file in
`pipes/` is picked up at the next opencode start; a file that does not implement `PipeDef`
stops the plugin from loading with an error naming the file.
