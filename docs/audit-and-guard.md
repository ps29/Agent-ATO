# Audit log, Guard and reports

## Audit log

Every tool call the agent makes is written to the `audit_log` table in `~/.agent-ato/agent-ato.db`:

| kind | written when |
|---|---|
| `call` | a tool call is first seen in a transcript |
| `result` | its result arrives (status `ok` or `error`) |
| `guard` | Guard denied, asked about, or (in monitor mode) would have acted on a call |
| `control` | Guard settings or rules were changed |

Each row stores the time, session, tool, CRUD operation, risk rating, target, and up to 4 KB of code and result text.
The `(session, tool call, kind)` triple is unique, so re-reading a transcript never adds duplicates.

### Tamper evidence

Each row's `hash` is `sha256(previous hash | row contents)`. Editing or deleting a row breaks every hash after it, and
**Verify chain** in the Audit tab (or `GET /api/audit/verify`) reports the first broken entry.

This detects accidental or casual changes. It does **not** stop someone who can rewrite the whole database file, because
they could rebuild the chain. Write down the head hash shown in the Audit tab (or keep it in another system): a rebuilt
chain cannot reproduce a head hash you recorded earlier.

### Backfilling history

Entries are written as sessions are ingested. To add older sessions already stored in the database:

```
node apps/server/dist/cli.js audit-backfill
```

**Stop the server first.** The server holds the chain head in memory, so a second writer would fork the chain.

## Risk ratings

`assessRisk` (in `packages/shared/src/risk.ts`) gives every tool call `low`, `medium`, `high` or `critical`, with reasons.
Rules look at the command text (for example `rm -rf` on a root path, `git push`, `curl | sh`, `DROP TABLE`) and at the path a
file tool touches (`.ssh`, `.env`, `.claude/settings.json`, system folders).

The ratings read text only. They cannot see what a script does or what the shell expands, and a quoted mention of a
dangerous command can match. Treat them as a prompt for attention, not a security boundary.

## Guard

Guard runs inside the `PreToolUse` hook. Before each tool call, Claude Code asks the local server what to do:

1. **Halt** is on: deny everything, in any mode.
2. Mode **off**: do nothing.
3. A **rule** matches (substring or regex, optionally for one tool): deny or ask, as the rule says.
4. The call's risk meets **deny at least**: deny. Otherwise meets **ask at least**: ask.
5. Mode **monitor** turns any deny or ask into an audit entry (`would deny`) and lets the call through.

Guard only ever returns `deny` or `ask`. It never returns `allow`, so Claude Code's own permission prompts still apply.

### Limits

- Needs hooks. Run `node apps/server/dist/cli.js install-hooks`, then start a **new** Claude Code session. Until then Guard cannot stop anything; the audit log and risk labels still work from transcripts.
- It cannot interrupt a command that is already running. Press Esc or Ctrl+C in that terminal.
- Hooks **fail open**: if the server is down or takes over 3 seconds, the call proceeds.
- Rules match text. A determined agent can phrase a command to avoid a pattern; use Guard to catch mistakes, not to contain a hostile process.
- Control endpoints need the `x-agent-ato-ui` header, which browsers will not send cross-site without a CORS preflight that the server never approves.

## Reports

From the Live tab, **Report…** generates a Markdown draft of one session as a post-incident review, root cause analysis,
change log or RFC (`GET /api/report?id=<session>&kind=pir|rca|changelog|rfc`).

The generator fills in only what the logs show: timeline, failures, file and command changes, risky actions, Guard decisions
and the agent's commentary. Sections that need human judgement (impact, detection, root cause, alternatives, action items)
are left as `TODO (human)` blocks and are never guessed.

Claude Code does not store the model's private thinking text, only its size and duration, so "reasoning" in the Reasoning
tab and in reports means the visible commentary the agent wrote between tool calls.
