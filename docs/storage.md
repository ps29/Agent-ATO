# Where data is stored

Everything Agent ATO keeps is under `~/.agent-ato` (override with `AGENT_ATO_DATA`). The **Stats** tab shows the live
locations and sizes.

| What | Path | Notes |
|---|---|---|
| Database | `~/.agent-ato/agent-ato.db` | SQLite (WAL mode). Sessions, interactions, audit log, hook events, Guard rules. |
| Transcript archive | `~/.agent-ato/archive/<project>/<session>.jsonl.gz` | Full, lossless copy of every transcript. |
| Ingest token | `~/.agent-ato/token` | Lets the hook client talk to the server. Owner-only permissions where the OS supports it. |
| Original transcripts | `~/.claude/projects/...` | Written by Claude Code. Read only to Agent ATO. |

## What each layer keeps

| Layer | Detail | Survives Claude Code cleanup? |
|---|---|---|
| Archive | Every byte: all text, tool inputs and outputs, thinking size, sub-agent transcripts | Yes |
| `audit_log` | One hash-chained entry per user prompt, agent commentary, tool call, tool result, Guard decision and Guard setting change. Code up to 2 KB, results up to 500 characters, text up to 3.5 KB | Yes |
| `interactions` | Parsed view used by the dashboard. Tool input and output are capped at 3 KB each to keep the UI fast | Yes |
| `hook_events` | The full payload of every hook call (real-time tool inputs, before the transcript is written) | Yes |

Claude Code removes old transcripts after a retention period (30 days unless `cleanupPeriodDays` is set in its settings).
The archive is what keeps the complete record after that. The audit log and database keep the capped view.

## Reading the archive

Each file is a series of gzip members, so standard tools restore the original bytes:

```
gunzip -c ~/.agent-ato/archive/<project>/<session>.jsonl.gz > session.jsonl
```

If Claude Code ever replaces a transcript with a shorter one, the old copy is kept next to the new one as
`<session>.jsonl.<timestamp>.gz`.

## What is *not* recorded

- The model's private thinking text. Claude Code does not write it to the transcript (the blocks are empty); only the
  token count and duration are stored.
- Anything that happened outside Claude Code's own logs, such as what a script did internally after the agent started it.
- Activity from before Agent ATO first read a transcript, unless that transcript still exists. Run it once to copy what
  is still on disk.

## Disk use and cleanup

The archive is compressed, but transcripts with screenshots compress poorly. Check the size on the Stats tab. To reclaim
space, stop the server and delete `~/.agent-ato/archive`; it is rebuilt from the transcripts still in `~/.claude/projects`
on the next start (history Claude Code already deleted cannot be rebuilt).

The archive holds everything the agent saw, including any secrets that appeared in files or command output. It has the same
sensitivity as `~/.claude/projects`; keep `~/.agent-ato` private and exclude it from shared backups.
