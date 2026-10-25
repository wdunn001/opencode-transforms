# The pipes

Listed in the order they run. The name is what `STRATA_PIPES_OFF` takes.

| Name | Order | Runs on | Matches | Does |
|---|---|---|---|---|
| `stripAnsi` | 0 | tool output | terminal escape codes | removes color and cursor codes |
| `jsonlCrush` | 10 | tool output, prompts | most sampled lines are `{...}` records | long runs of same-shaped records keep the first 3, the last 2 and every record that mentions an error |
| `jsonCrush` | 11 | tool output, prompts | text that looks like JSON and parses | the same rule for every long array of same-shaped objects, anywhere in the document; output is minified |
| `logCollapse` | 20 | tool output, prompts | most sampled lines start with a timestamp or a level word | runs of lines that differ only in timestamps, hex ids and numbers become the first line, a note and the last line |
| `dedupeLines` | 30 | tool output, prompts | three identical lines in a row | runs of identical lines become the line, a note and the line again |
| `headTail` | 40 | tool output | more than 400 lines | keeps the head and tail, plus up to 48 error lines from the middle, with a note for each gap |

`jsonlCrush` and `jsonCrush` share the group `structure`, so at most one of them runs.

What counts as an error: in JSON, an item whose text contains error, fail, exception, fatal,
denied, refused or timeout. In lines, a line with the word error, fatal, panic, exception,
traceback, fail, failed, failure or critical.

Lines compare equal for `logCollapse` after these replacements: ISO, slash and syslog
timestamps become `<ts>`, hex strings of 8 or more characters with at least one letter become
`<id>`, and remaining numbers (decimals included) become `<n>`.
