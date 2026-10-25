# Configuration

Set these in the environment opencode starts in.

| Variable | Effect |
|---|---|
| `STRATA_TRANSFORMS=0` | turns the plugin off |
| `STRATA_PIPES_OFF=a,b` | turns single pipes off by name, for example `STRATA_PIPES_OFF=headTail,dedupeLines` |
| `STRATA_TRANSFORMS_LOG=path` | appends one JSON line per item that a pipe matched |
| `STRATA_SKILL_PICK=0`, `STRATA_DECIDE_URL` | the skill pick, see [skill-pick.md](skill-pick.md) |

A log line looks like this:

```json
{"kind":"tool","sessionID":"ses_...","seq":2,"before":49587,"after":3070,"matched":["logCollapse","headTail"],"pipes":["logCollapse"]}
```

`matched` lists the pipes whose test passed and `pipes` the ones that changed the text.
The log never contains content. A failure to write the log never breaks a tool call.

The gates (8,000 characters, the protected tools) and the pipe limits are constants at the
top of `plugin-lib/pipeline.ts` and of each pipe file.
