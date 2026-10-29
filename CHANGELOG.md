# Changelog

## Unreleased

- Operations tab (CRUD view) with syntax-highlighted code boxes.
- Risk assessment for tool calls, shown in Operations, Reasoning and the audit log.
- Reasoning tab; Audit tab with a hash-chained, verifiable log and `audit-backfill`.
- Guard: modes, thresholds, rules and a Halt button, enforced through the PreToolUse hook (deny or ask only).
- Draft SRE documents from a session: post-incident review, RCA, change log, RFC.
- Display settings: themes (Solarized, high contrast), accessible fonts, size, spacing and bold.
- Pause/resume ingestion and restart/stop from the web UI; `start` now supervises the server, `serve` runs it directly.
- Hook client may now print a PreToolUse permission decision; it still fails open.

## 0.1.0

- Incremental transcript parser and D/R/W/E classifier (`@agent-ato/shared`).
- Server: file watcher, SQLite log with full-text search, REST API, live event stream, optional hooks, export.
- Web app: live timeline with token chart, detail panel, event log, stats, memory viewer, search palette, alerts.
