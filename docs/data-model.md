# Data model

SQLite file: `~/.agent-ato/agent-ato.db` (WAL mode). The schema is versioned with `PRAGMA user_version`; migrations live in `apps/server/src/store/db.ts` and run on start.

| Table | Purpose |
| --- | --- |
| `sessions` | One row per transcript: title, project, cwd, branch, models, times, counters, compaction positions, prompts (JSON), `file_size` of the last full ingest |
| `interactions` | One row per interaction: `label`, `tags`, `has_error`, `start_ms`, full `data` (JSON), and `rid`, the rowid of its full-text row |
| `search` | FTS5 table over labels, narration, tool inputs and the first 1000 characters of outputs |
| `hook_events` | Raw hook events with session, tool name, `tool_use_id` and payload |

## Notes

- The database is a **log**, not a mirror: rows stay after Claude Code removes the transcript.
- It can be rebuilt from transcripts by deleting the file and restarting, but hook events and history of deleted transcripts would be lost.
- Full-text rows are addressed by rowid. Filtering an FTS table on its unindexed columns scans the whole table, so deletes use `rid`.
- Stored text is capped (3000 characters per field) to keep the database small.
