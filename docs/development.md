# Development

## Setup

```bash
nvm use            # Node 24 (.nvmrc); Node >= 22.13 works
npm ci
npm run build -w @agent-ato/shared
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Server (tsx watch) and Vite dev server |
| `npm run build` | Builds shared, web, then server |
| `npm start` | Runs the built server on http://127.0.0.1:4317 |
| `npm test` | Vitest in every workspace |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run format` | Prettier |

The server and web app import `@agent-ato/shared` from its built `dist/`, so rebuild it after changing shared code.

## Tests

- `packages/shared/test`: classifier table tests and parser tests, including feeding the parser in tiny chunks to prove chunking never changes the result.
- `apps/server/test`: incremental ingest, truncation handling, Host and token checks, CSV export, hook install and removal, path containment. Uses an in-memory SQLite database and a temp folder, never your real `~/.claude`.
- `apps/web/test`: timeline math.

## Adding a feature

1. Put types and logic that both sides need in `packages/shared`.
2. Persist in `apps/server/src/store`; add a migration rather than editing an old one.
3. Expose through `apps/server/src/app.ts`, then call it from `apps/web/src/api.ts`.
4. Add a test next to the layer you changed.

## Release

Update `CHANGELOG.md`, bump versions, run `npm ci && npm run lint && npm run typecheck && npm test && npm run build`.
