# Agent ATO

A local web app that watches Claude Code while it works. It logs every action, labels it, and shows each session as a live timeline.

This project is based on the paper [*Agent ATO: Visualizing Agent Interaction Timelines from Logs*](https://arxiv.org/abs/2609.08301) by Takuto Kawamoto, Yoshiki Higo and Raula Gaikovina Kula (The University of Osaka). See [Credits](#credits). Every interaction is tagged **Discovery**, **Reading**, **Writing** or **Execution**. A token chart shows whether tokens came from long model output or from large tool results.

## What you get

- **Live timeline** per session: an all-interactions row plus one row per tag, and an aligned token chart with a context-size line. New interactions appear within about a second.
- **Detail panel** for each interaction: the prompt, visible narration, reasoning metrics, every tool call with its input and output, and an estimate of what grew the context.
- **Sub-agents** shown under their parent session.
- **Event log** (filter by tag or errors) and **full-text search** across every session (`Ctrl K`).
- **Alerts** for tool errors, `.env`/key/credential paths, large responses, and your own regex.
- **Stats**, **MEMORY.md viewer**, and **export** to JSON, CSV or Markdown.
- A **SQLite log** that keeps history after Claude Code deletes old transcripts.

## About reasoning

Claude Code stores thinking blocks **without their text**. The app shows what is recorded: the visible narration between tool calls, thinking token counts, thinking time and effort level. It shows thinking text if a future Claude Code version starts saving it.

Tool-result token counts are **estimates** (characters ÷ 4), because transcripts contain no exact figure. They are marked "≈" everywhere.

## Quick start

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run build
npm start          # http://127.0.0.1:4317
```

Development with hot reload (web on :5173, API on :4317):

```bash
npm run dev
```

The server reads `~/.claude/projects` and never writes there. Its own data lives in `~/.agent-ato/`.

## Optional: real-time hooks

Transcript tailing is enough for most uses. Hooks add instant events.

```bash
npm run build
node apps/server/dist/cli.js install-hooks     # edits ~/.claude/settings.json (backup kept)
node apps/server/dist/cli.js uninstall-hooks   # removes only what it added
```

See [docs/hooks.md](docs/hooks.md). `node apps/server/dist/cli.js doctor` checks your setup.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `AGENT_ATO_PORT` | `4317` | HTTP port |
| `CLAUDE_ROOT` | `~/.claude` | Claude Code data folder (read only) |
| `AGENT_ATO_DATA` | `~/.agent-ato` | Database and ingest token |
| `AGENT_ATO_WEB` | built `apps/web/dist` | Folder of static web files |

## Security

- Binds to `127.0.0.1` only, and rejects requests whose `Host` header is not `localhost`, `127.0.0.1` or `[::1]` on the app's port (DNS-rebinding protection). No CORS headers are sent.
- Transcripts can contain secrets. Do not expose the port to a network.
- Hook ingest needs the per-install token in `~/.agent-ato/token`.
- File reads (the memory viewer) are limited to `~/.claude/projects` by a path-containment check.
- CSV export neutralises spreadsheet formulas.

## Project layout

```
packages/shared   types, tag classifier, incremental transcript parser (no I/O)
apps/server       Fastify API + SSE, chokidar watcher, node:sqlite store, CLI, hook client
apps/web          React + Vite UI
docs/             architecture, tagging rules, hooks, data model, development
```

More: [architecture](docs/architecture.md) · [tagging rules](docs/tagging-rules.md) · [data model](docs/data-model.md) · [development](docs/development.md)

## Credits

The timeline design comes from the Agent ATO paper: the all-interactions row, the filtered Discovery, Reading, Writing and Execution rows, and the token view that separates model output from tool results.

> Takuto Kawamoto, Yoshiki Higo and Raula Gaikovina Kula. *Agent ATO: Visualizing Agent Interaction Timelines from Logs.* arXiv:2609.08301, 2026. https://arxiv.org/abs/2609.08301

This is an independent implementation. It is not affiliated with or endorsed by the paper's authors, and it is a different tool: it reads Claude Code transcripts rather than Pi agent logs, runs as a live web app, and adds a SQLite log, search, alerts and hooks. The authors' own prototype and replication package are linked from the paper.

Ideas for the context view, alerts and search were also inspired by [claude-devtools](https://github.com/matt1398/claude-devtools) (MIT). No code was copied from it.

## License

MIT
