# Hooks

Hooks let Claude Code tell Agent ATO about each event the moment it happens. They are optional: without them the app tails transcripts and lags by about a second.

## Install and remove

```bash
node apps/server/dist/cli.js install-hooks
node apps/server/dist/cli.js uninstall-hooks
```

`install-hooks`:

1. copies `~/.claude/settings.json` to `settings.json.agent-ato.bak`;
2. adds one command hook for each of `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`, `SessionStart` and `Notification`;
3. does nothing for events it already registered, so running it twice is safe.

Every command it adds contains the marker `agent-ato-managed`. `uninstall-hooks` removes only commands with that marker and leaves your own hooks untouched.

## What the hook client does

`apps/server/hook-client.mjs` reads the hook payload from stdin and POSTs it to `http://127.0.0.1:4317/ingest/hook` with the token from `~/.agent-ato/token`.

- It prints nothing and always exits 0, so it can never block or fail a Claude Code action.
- It gives up after 500 ms, so a stopped server costs nothing noticeable.
- The server rejects requests without the token (401) and malformed payloads (400).

Hook events are stored in SQLite and shown in the detail panel of the matching tool call, linked by `tool_use_id`. A `PreToolUse` with no `PostToolUse` yet marks the call as running.
