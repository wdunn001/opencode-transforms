# Skill pick

`plugins/skill-pick.ts` keeps skills out of the system prompt and loads the right one
when a prompt arrives.

opencode lists every skill's name and description in every request. With 43 skills that
list was 20,117 characters, about a third of a request that had no conversation in it yet.
The plugin takes the user skills out of opencode's skill registry, so they are no longer
listed, and keeps them in its own index. The two built-in opencode skills stay listed.

## Per prompt

Each new prompt is handled once, when it enters the session, like the pipes.

1. **Shortlist.** The prompt's words are scored against each skill's name and description,
   weighted by how rare each word is across all skills. A word in the name counts double.
   Up to 15 skills that score at least 2.5 go on. If none do, nothing else happens, and
   most prompts stop here at no cost.
2. **Decision.** One `/v1/decide` call to a
   [decide-gateway](https://devops.quasarke.net/wdunn001/opencode-stack) asks the model
   which shortlisted skill the request needs, with "none" as an option. The answer is the
   model's next-token probability over the option letters.
3. **Inject.** If the top option is a skill at probability 0.6 or more, its `SKILL.md`
   is appended to the prompt as a `<skill_content>` block, the shape opencode uses for a
   skill the user invokes. A body over 8,000 characters is announced instead, with a
   pointer to `skill_load`. A skill goes in at most once per session.

The request carries a catalog: every skill with the first 260 characters of its
description. The catalog is identical on every call, so the engine keeps it cached and a
decision re-reads only the prompt and a few option names. It is also long enough (about
2,300 tokens) to clear Strata's `--conversation-cache-min-tokens 2048`, so it keeps a cache
slot of its own. Shorter, it lived only in the live context: every main turn evicted it,
and the next decision took about 4 s. The plugin warms the catalog once at startup.

## Tools

- `skill_find(query)`: up to 5 skill names with descriptions, from the same index.
- `skill_load(name)`: a skill's full `SKILL.md`.

Both are for a need that shows up mid-task, after the prompt was handled.

## Switches

| Variable | Effect |
|---|---|
| `STRATA_SKILL_PICK=0` | no per-prompt pick; skills stay unlisted and reachable through the tools |
| `STRATA_DECIDE_URL=url` | decide-gateway base URL, default `http://127.0.0.1:8889` |
| `STRATA_TRANSFORMS_LOG=path` | one line per prompt: options, choice, probability, injected id, ms |

Skills denied in `permission.skill` in `opencode.jsonc` are left out of the index.

## Measured

`eval/skill-pick.eval.ts` runs the labelled prompts in `eval/skill-prompts.json` (16 that
need a skill, 6 that need none) against the live gateway:

```
node --experimental-strip-types eval/skill-pick.eval.ts
```

On 2026-10-25 (Strata, Qwen3.8 Flash Next, ROG Flow Z13): 22/22 right, no wrong
injection, decision time p50 899 ms and p95 976 ms with the catalog cached. The first call
after a catalog change takes about 5 s.
