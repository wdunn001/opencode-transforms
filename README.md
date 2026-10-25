# opencode-transforms

An [opencode](https://opencode.ai) 2.x plugin that shrinks large tool outputs and pasted
prompts once, at the moment they enter a session, before opencode stores them.

opencode stores every tool result and resends the whole history on each request. A
compressor that sits between opencode and the model (a proxy) sees the original text again
on every turn, so it has to redo or cache its work, and any change it makes to old turns
breaks the engine's prompt cache. This plugin changes the text before it is stored. opencode
then keeps and resends the smaller version, nothing is processed twice, and the prompt prefix
stays byte-identical from turn to turn.

It was built for a local model on a single machine, where every token of prompt costs
prefill time, but it works with any provider.

## What it does to a big output

| Content | Result |
|---|---|
| A 49 KB build log of repeated lines | 3 KB: repeated lines folded into one with a count, every error line kept |
| JSON with a 500-item array of same-shaped objects | first 3 and last 2 items, every item that mentions an error, and a note with the count left out |
| A 5,000-line command output | the first and last lines, up to 48 error lines from the middle, and notes for each gap |
| Output with terminal color codes | the same text without the escape codes |

Anything left out is stated in plain text in the output, so the model knows it is looking
at a summary. Files the model reads to edit (`read`, `edit`, `write`, `patch`, `multiedit`,
`apply_patch`) are never touched, and outputs under 8,000 characters pass through unchanged.

## Install

Requires opencode 2.x. The tests and benchmark need Node 22 or newer.

    git clone https://github.com/wdunn001/opencode-transforms.git
    cd opencode-transforms
    ./install.sh                 # into ~/.config/opencode
    ./install.sh /path/to/dir    # into another opencode config directory

Restart opencode afterwards. To check that it is working, set
`STRATA_TRANSFORMS_LOG=/tmp/transforms.log` before starting opencode and run something with
a large output; the log gets one line per transformed item.

## Measured results

Qwen3.8-Flash-Next (IQ3_S) on a local Strata engine, opencode 2.1.4, 2026-10-24:

- 123 real large tool outputs from opencode sessions came out 29.2% smaller overall.
- Choosing pipes by regex took 12.9 µs per output, against 38.9 µs for trying a JSON parse
  first, with no wrong picks.
- A task that reads a 49 KB log: 93.5 s down to 75 s on average, prompt tokens read
  42.3K down to 18.1K, the stored output 49,587 down to 3,070 characters.
- Tasks whose outputs were under the size gate were left untouched; the end-to-end bench
  passed 16 of 16 runs.

## Documentation

- [How it works](docs/how-it-works.md): the two hooks, the cursor, the pipeline, the gates
- [The pipes](docs/pipes.md): what each built-in pipe matches and does
- [Writing a pipe](docs/writing-a-pipe.md): the `PipeDef` interface and an example
- [Configuration](docs/configuration.md): environment switches and the log
- [Testing and benchmarking](docs/testing.md)

## Status

Working and in daily use. opencode 2.x has no published plugin types package that matches
its runtime (`@opencode-ai/plugin` 1.19.4 does not), so the hook arguments are typed loosely
and a future opencode release could change their shape.
