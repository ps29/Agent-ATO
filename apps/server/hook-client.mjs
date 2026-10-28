#!/usr/bin/env node
// Claude Code hook client for Agent ATO. Reads the hook payload from stdin and forwards it to the
// local server. It must never block or fail Claude Code: no stdout, 500 ms cap, always exit 0.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const done = () => process.exit(0);
setTimeout(done, 500).unref();

try {
  const dataDir = process.env.AGENT_ATO_DATA ?? join(homedir(), '.agent-ato');
  const port = process.env.AGENT_ATO_PORT ?? '4317';
  const token = readFileSync(join(dataDir, 'token'), 'utf8').trim();
  let body = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) body += chunk;
  await fetch(`http://127.0.0.1:${port}/ingest/hook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-agent-ato-token': token },
    body,
    signal: AbortSignal.timeout(400),
  });
} catch {
  /* server down or not installed: ignore */
}
done();
