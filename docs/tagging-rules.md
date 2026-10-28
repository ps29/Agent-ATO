# Tagging rules

Each tool call gets zero or more tags. An interaction carries the union of its tool calls' tags. Rules are in `packages/shared/src/classify/` and tested in `packages/shared/test/classify.test.ts`.

| Tag | Name | Examples |
| --- | --- | --- |
| `D` | Discovery | `Glob`, `Grep` in files mode (the default), `ls`, `find`, `Get-ChildItem`, `rg -l`, `git status`, `WebSearch`, `ToolSearch`, Explore agents |
| `R` | Reading | `Read`, `Grep` in content mode, `cat`, `Get-Content`, `rg`/`grep` without `-l`, `git diff`, `git log`, `WebFetch` |
| `W` | Writing | `Edit`, `Write`, `NotebookEdit`, `rm`, `mv`, `cp`, `mkdir`, `Set-Content`, `sed -i`, `>` redirects, `git add`/`commit`/`reset` |
| `E` | Execution | tests, builds, scripts, interpreters, `git push`, and any shell command not recognised above |

Other categories are kept separately and do not replace tags: `delegation` (Agent), `interaction` (AskUserQuestion, plan mode), `web`, `mcp`.

## Shell commands

- The command is split on `|`, `&&`, `||`, `;` and newlines, respecting quotes. Heredoc and here-string bodies are removed first, so text inside them is never parsed as commands.
- In a pipeline only the **first** command decides discovery or reading. Later pieces such as `| head` are filters. Writers (`tee`, `Out-File`, `>`) and interpreters still count.
- Output redirects to `/dev/null`, `$null` and `nul` do not count as writing.
- `cd`, `echo` and similar no-ops add no tag.

## MCP tools

Tagged by a verb in the tool name: `search`/`list`/`find`/`query` → D, `read`/`get`/`fetch`/`screenshot`/`text` → R, `create`/`update`/`delete`/`write`/`edit`/`set_`/`trash` → W. Anything else is untagged.

## Labels

A short label is built per call, for example `npm run build`, `rg | head`, `Read parser.ts`, `Gmail:search_threads`. Hovering a cell highlights every cell with the same label, which shows repeated operations.

## Changing the rules

Edit the sets at the top of `classify/shell.ts` or the switch in `classify/tools.ts`, add a case to `classify.test.ts`, and run `npm test`. These rules are heuristic and unvalidated, as in the paper.
