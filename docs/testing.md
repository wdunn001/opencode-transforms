# Testing and benchmarking

## Tests

    node --experimental-strip-types --test plugin-lib/pipeline.test.ts

They cover the gates, purity (same input twice gives identical bytes), idempotence, the
loader (invalid pipes and duplicate names are rejected), and each pipe on fixtures.

## Detection benchmark

    node --experimental-strip-types bench/pipebench.ts corpus.jsonl

`corpus.jsonl` has one `{"tool": name, "text": output}` object per line, for example real
tool outputs exported read-only from opencode's database. The benchmark compares regex-first
detection with parse-first detection (time per payload and wrong picks) and reports how much
smaller the pipeline makes the corpus.

## End to end

The measured results in the README come from running the same opencode tasks with the plugin
on and off (`STRATA_TRANSFORMS=0`) and comparing pass or fail, wall time and prompt tokens.
When scripting `opencode run`, redirect stdin (`< /dev/null`): it reads a non-terminal stdin
and waits for it to close.
