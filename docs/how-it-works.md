# How it works

## Two entry points

| Hook | Fires on | Changes |
|---|---|---|
| `ctx.tool.hook("execute.after")` | every completed tool call, built-in or MCP, before opencode stores the result | the result's text parts and its structured `output.output` |
| `ctx.session.hook("prompt")` | every new user prompt, before it is stored | the prompt text |

Both run before opencode writes to its database, so what is stored, shown and resent is the
transformed text. The plugin never rewrites the outgoing request to the model, and it never
looks at history.

When a tool result carries the same text in both its content parts and its structured
output, the text is transformed once and the result reused for both.

## The cursor

For each session the plugin keeps a cursor: a sequence number, the last message and call IDs,
and the set of IDs already evaluated (the most recent 4,096). An ID the cursor has seen is
skipped, so a hook that fires twice for the same item cannot transform it twice. Nothing is
saved to disk: after a restart the hooks only fire for new items, and stored items were
already transformed when they came in.

## The pipeline

Pipes live one per file in `plugin-lib/pipes/`. At startup `loadPipes()` imports every file
once, checks that each one implements `PipeDef`, rejects duplicate names, and sorts them by
`order`.

`run()` then handles one piece of text:

1. Gates. Text under 8,000 characters (about 2K tokens) is returned unchanged. So is the
   result of a protected tool (`read`, `edit`, `write`, `patch`, `multiedit`,
   `apply_patch`), because the model edits files using that exact text.
2. Each pipe, in order, that applies to this source (`tool` or `prompt`) and is not switched
   off is tested with its regex. A `text` pipe tests the whole text; a `lines` pipe tests up
   to 40 sampled lines and needs at least `minShare` of them to match.
3. If the regex matches and the pipe has a `confirm` step (for example a full JSON parse),
   that runs next. Regex first keeps the common case cheap.
4. Pipes that share a `group` are alternatives: only the first that matches runs.
5. The pipe's `transform` gets the current text and returns the new text, which becomes
   the input of the next pipe.

Every transform is pure (no I/O, clock or randomness) and idempotent: running it on its own
output changes nothing. Notes the pipeline inserts, such as `[... 12 similar lines omitted ...]`,
are excluded from line sampling so a second pass never treats them as content.
