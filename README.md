# opencode-transforms

An opencode 2.x plugin that shrinks large tool outputs and pasted prompts once, at the
point they enter the session, before opencode stores them. opencode then stores and
resends the smaller text, so nothing is compressed again on later requests and the
engine's prompt cache stays intact.

It was written for a local model (Strata) where a proxy-side compressor (Headroom) would
have had to re-process the whole history on every request.

## How it works

- Two entry points: `tool.execute.after` (every tool response, built-in or MCP) and
  `session.prompt` (a new user prompt).
- A per-session cursor records the IDs already evaluated, so an item is never evaluated twice.
- Detection is regex-first, then pure transforms run in order, each one's output feeding
  the next. Each pipe is one file in `plugin-lib/pipes/` implementing `PipeDef` (name,
  description, order, sources, match regex, matchMode, optional confirm, group, transform).
  All pipes load once at init.
- Gates: text under 8000 characters is left alone, and so are the results of `read`,
  `edit`, `write`, `patch`, `multiedit` and `apply_patch` (the model edits exact text).
- Every omission is stated in plain text in the output.

| Pipe | Order | What it does |
|---|---|---|
| strip-ansi | 0 | removes terminal escape codes (tool output only) |
| jsonl-crush | 10 | JSON Lines: long runs of same-shaped records keep head, tail and error-looking records |
| json-crush | 11 | the same for JSON arrays (confirmed by a parse) |
| log-collapse | 20 | log lines differing only in timestamps, ids and numbers collapse to first, note, last |
| dedupe-lines | 30 | runs of identical lines collapse |
| head-tail | 40 | over 400 lines: head and tail kept, plus up to 48 error lines (tool output only) |

## Install

    ./install.sh            # into ~/.config/opencode
    ./install.sh <dir>      # into another opencode config dir

Restart opencode afterwards.

Environment:

- `STRATA_TRANSFORMS=0` turns the plugin off.
- `STRATA_PIPES_OFF=a,b` turns single pipes off by name.
- `STRATA_TRANSFORMS_LOG=path` appends one line per evaluation (sizes, matched and changing pipes; never content).

## Test and benchmark

    node --experimental-strip-types --test plugin-lib/pipeline.test.ts
    node --experimental-strip-types bench/pipebench.ts <corpus.jsonl>

## Results (2026-10-24, Qwen3.8-Flash-Next DavidAU IQ3_S on Strata)

- 123 real large tool outputs from opencode sessions: 29.2% smaller overall.
- Detection: regex-first 12.9 us per payload against 38.9 us for parse-first, no wrong picks.
- A task reading a 49 KB log: 93.5 s down to 75 s on average, tokens read 42.3K down
  to 18.1K, the stored output 49,587 down to 3,070 characters.
- Tasks with outputs under the gate were left untouched; the end-to-end bench passed 16/16.

## Note

opencode 2.x publishes no matching `@opencode-ai/plugin` package (1.19.4's types do not
match runtime 2.1.4), so the hooks are typed loosely.
