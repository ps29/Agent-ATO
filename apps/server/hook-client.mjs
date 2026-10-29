#!/usr/bin/env node
// Claude Code hook client for Agent ATO. Reads the hook payload from stdin and forwards it to the
// local server. Failure policy: if the server is down or slow this exits 0 with no output, so
// Claude Code carries on as if the hook were not installed (fail open).
// The only output is a PreToolUse permission decision when the server asks to deny or confirm a call.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const done = () => process.exit(0);
setTimeout(done, 4000).unref();

try {
  const dataDir = process.env.AGENT_ATO_DATA ?? join(homedir(), '.agent-ato');
  const port = process.env.AGENT_ATO_PORT ?? '4317';
  const token = readFileSync(join(dataDir, 'token'), 'utf8').trim();
  let body = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) body += chunk;
  const gate = body.includes('"PreToolUse"');
  const res = await fetch(`http://127.0.0.1:${port}/ingest/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-ato-token': token },
    body,
    signal: AbortSignal.timeout(gate ? 3000 : 400),
  });
  if (gate && res.ok) {
    const out = await res.json();
    if (out && out.hookSpecificOutput) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput: out.hookSpecificOutput }), done);
      await new Promise(() => undefined);
    }
  }
} catch {
  /* server down or not installed: ignore */
}
done();
