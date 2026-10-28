# Architecture

```
~/.claude/projects/**/*.jsonl ──chokidar──> Watcher ──bytes──> TranscriptParser (shared)
                                               │                     │ changed interactions
Claude Code hooks ──hook-client.mjs──> POST /ingest/hook             ▼
                                               │              Repo (node:sqlite)
                                               ▼                     │
                                            EventHub ◀───────────────┘
                                               │ SSE  /api/stream
                                               ▼
                                         React web app  (REST: /api/*)
```

## Packages

- **`@agent-ato/shared`**: pure TypeScript with no I/O. Holds the event types, the tag classifier and `TranscriptParser`.
- **`@agent-ato/server`**: the process you run. One port serves the API, the event stream and the built web app.
- **`@agent-ato/web`**: the UI. It uses a zustand store that merges server-sent deltas into the open session.

## Data flow

1. The **watcher** reacts to file changes, debounces them, reads only the new bytes from a stored offset, and decodes them with a `StringDecoder` so multi-byte characters split across reads are safe.
2. **`TranscriptParser`** buffers a partial last line and parses complete JSONL records.
   - One API response is split into several records, one per content block. They share a `requestId`, so records are grouped by it and usage is counted once.
   - A `tool_result` arrives in a later record and is joined to its `tool_use` by id. It can update an earlier interaction.
3. Each changed interaction is classified, upserted into SQLite, indexed for full-text search, and published on the hub.
4. The SSE endpoint forwards hub events to browsers. The browser applies them to the open session and evaluates alert rules.
5. Truncated or replaced files restart from offset zero. On startup, a file whose size matches the stored size is skipped.

## Event model

| Concept | Meaning |
| --- | --- |
| Interaction | One API response (`requestId`) and the tool results it triggered |
| ToolCall | One `tool_use` with input, output and status (`pending`, `ok`, `error`) |
| Prompt | A user message; interactions point to the prompt that started them |
| Session | One transcript file. Sub-agent files are separate sessions linked by `parentId` |

## Design choices

- **`node:sqlite`** instead of a native module: no compile step and no prebuilt-binary problems on new Node versions.
- **SSE** instead of WebSocket: one-way updates, automatic reconnect, plain HTTP.
- **No charting library.** The timeline is plain SVG with a few lines of scale math, which keeps the bundle small (about 77 kB gzipped).
- **Server-side classification**, shared with the UI through one package, so the log, search and timeline always agree.
