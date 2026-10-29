import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { installHooks, uninstallHooks } from '../src/hooks-install.js';
import { EventHub, type ServerEvent } from '../src/ingest/hub.js';
import { Watcher, identify } from '../src/ingest/watcher.js';
import { isContained } from '../src/security.js';
import { openDb } from '../src/store/db.js';
import { Repo } from '../src/store/repo.js';

const usage = { input_tokens: 1, output_tokens: 10, output_tokens_details: { thinking_tokens: 0 } };
const line = (o: object): string => `${JSON.stringify(o)}\n`;
const assistant = (rid: string, content: object[]): string =>
  line({ type: 'assistant', requestId: rid, timestamp: '2026-01-01T00:00:01Z', message: { model: 'm', usage, content } });

let tmp: string;
let projects: string;
let sessionFile: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ato-'));
  projects = join(tmp, 'projects');
  mkdirSync(join(projects, 'proj'), { recursive: true });
  sessionFile = join(projects, 'proj', 'sess1.jsonl');
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

function setup() {
  const repo = new Repo(openDb(':memory:'));
  const hub = new EventHub();
  const config: Config = { claudeRoot: tmp, dataDir: tmp, host: '127.0.0.1', port: 4317, webDir: null };
  const app = buildApp({ config, repo, hub, token: 'secret' });
  const events: ServerEvent[] = [];
  hub.subscribe((e) => events.push(e));
  return { repo, hub, app, events, watcher: new Watcher(projects, repo, hub, 0) };
}
const H = { host: 'localhost:4317' };

describe('watcher + store', () => {
  it('ingests appended bytes incrementally and joins late tool results', async () => {
    const { watcher, repo, events } = setup();
    writeFileSync(sessionFile, line({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'hi' } }) +
      assistant('r1', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]));
    watcher.ingest(sessionFile);
    expect(repo.getSnapshot('sess1')!.items[0]!.tools[0]!.status).toBe('pending');

    appendFileSync(sessionFile, line({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a.txt' }] } }));
    watcher.ingest(sessionFile);
    const snap = repo.getSnapshot('sess1')!;
    expect(snap.items).toHaveLength(1);
    expect(snap.items[0]!.tools[0]).toMatchObject({ status: 'ok', output: 'a.txt' });
    expect(events.filter((e) => e.type === 'interactions')).toHaveLength(2);
    expect(repo.search('ls')[0]).toMatchObject({ sessionId: 'sess1', idx: 0 });
  });

  it('restarts from scratch when a file is truncated', () => {
    const { watcher, repo } = setup();
    writeFileSync(sessionFile, assistant('r1', [{ type: 'text', text: 'long long long' }]) + assistant('r2', [{ type: 'text', text: 'x' }]));
    watcher.ingest(sessionFile);
    writeFileSync(sessionFile, assistant('r9', [{ type: 'text', text: 'y' }]));
    watcher.ingest(sessionFile);
    expect(repo.getSnapshot('sess1')!.items[0]!.id).toBe('r9');
  });

  it('identifies sub-agent transcripts', () => {
    expect(identify(projects, join(projects, 'proj', 'sess1', 'subagents', 'agent-a.jsonl'))).toEqual({
      id: 'sess1/agent-a', parentId: 'sess1', project: 'proj',
    });
    expect(identify(projects, join(projects, 'proj', 'x.txt'))).toBeNull();
  });
});

describe('http api', () => {
  it('rejects unexpected Host headers', async () => {
    const { app } = setup();
    expect((await app.inject({ url: '/api/sessions', headers: { host: 'evil.example' } })).statusCode).toBe(403);
    expect((await app.inject({ url: '/api/sessions', headers: H })).statusCode).toBe(200);
  });

  it('requires the token for hook ingest and validates the payload', async () => {
    const { app, events } = setup();
    const post = (headers: Record<string, string>, payload: unknown) =>
      app.inject({ method: 'POST', url: '/ingest/hook', headers: { ...H, ...headers }, payload: payload as object });
    expect((await post({}, { hook_event_name: 'Stop' })).statusCode).toBe(401);
    expect((await post({ 'x-agent-ato-token': 'wrong' }, { hook_event_name: 'Stop' })).statusCode).toBe(401);
    expect((await post({ 'x-agent-ato-token': 'secret' }, { nope: 1 })).statusCode).toBe(400);
    const ok = await post({ 'x-agent-ato-token': 'secret' }, { hook_event_name: 'PreToolUse', session_id: 's', tool_name: 'Bash', tool_use_id: 'u' });
    expect(ok.statusCode).toBe(200);
    expect(events.at(-1)).toMatchObject({ type: 'hook', event: 'PreToolUse', toolUseId: 'u' });
  });

  it('returns one interaction with tool details', async () => {
    const { app, watcher } = setup();
    writeFileSync(sessionFile, assistant('r1', [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: 'ls' } }]));
    watcher.ingest(sessionFile);
    const ok = await app.inject({ url: '/api/interaction?session=sess1&idx=0', headers: H });
    expect(ok.json().tools[0]).toMatchObject({ name: 'Bash', status: 'pending' });
    expect((await app.inject({ url: '/api/interaction?session=sess1&idx=9', headers: H })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/interaction?session=sess1&idx=x', headers: H })).statusCode).toBe(404);
  });

  it('exports csv with formula neutralising', async () => {
    const { app, watcher } = setup();
    writeFileSync(sessionFile, assistant('r1', [{ type: 'tool_use', id: 't', name: 'Bash', input: { command: '=evil' } }]));
    watcher.ingest(sessionFile);
    const res = await app.inject({ url: '/api/export?id=sess1&format=csv', headers: H });
    expect(res.body).toContain(",'=evil,");
  });
});

describe('security helpers', () => {
  it('detects path escapes', () => {
    expect(isContained(join(projects, 'p', 'memory'), [projects])).toBe(true);
    expect(isContained(join(projects, '..', 'secret'), [projects])).toBe(false);
  });
});

describe('hook installation', () => {
  it('is idempotent, preserves user hooks and removes only its own', () => {
    const settings = join(tmp, 'settings.json');
    writeFileSync(settings, JSON.stringify({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }));
    expect(installHooks(settings, 'C:\\a\\hook-client.mjs').added).toBe(7);
    expect(installHooks(settings, 'C:\\a\\hook-client.mjs').added).toBe(0);
    expect(uninstallHooks(settings).removed).toBe(7);
    const after = JSON.parse(readFileSync(settings, 'utf8'));
    expect(after).toEqual({ model: 'x', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } });
  });
});

describe('process controls', () => {
  const UI = { ...H, 'x-agent-ato-ui': '1' };
  function withControl() {
    const s = setup();
    const calls: string[] = [];
    let paused = false;
    const app = buildApp({
      config: { claudeRoot: tmp, dataDir: tmp, host: '127.0.0.1', port: 4317, webDir: null },
      repo: s.repo,
      hub: s.hub,
      token: 'secret',
      control: {
        paused: () => paused,
        pause: () => {
          paused = true;
        },
        resume: () => {
          paused = false;
        },
        stop: () => calls.push('stop'),
        restart: () => calls.push('restart'),
        supervised: true,
      },
    });
    return { ...s, app, calls };
  }

  it('refuses control requests without the UI header or from a foreign origin', async () => {
    const { app } = withControl();
    expect(
      (await app.inject({ method: 'POST', url: '/api/control/stop', headers: H })).statusCode,
    ).toBe(403);
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/control/stop',
      headers: { ...UI, origin: 'https://evil.example' },
    });
    expect(foreign.statusCode).toBe(403);
  });

  it('pauses, resumes and announces the change', async () => {
    const { app, events } = withControl();
    const r = await app.inject({ method: 'POST', url: '/api/control/pause', headers: UI });
    expect(r.json()).toEqual({ paused: true });
    expect((await app.inject({ url: '/api/control', headers: H })).json()).toMatchObject({
      paused: true,
      supervised: true,
    });
    await app.inject({ method: 'POST', url: '/api/control/resume', headers: UI });
    expect(events.filter((e) => e.type === 'control')).toEqual([
      { type: 'control', paused: true },
      { type: 'control', paused: false },
    ]);
  });

  it('stop and restart reach the process hooks', async () => {
    const { app, calls } = withControl();
    await app.inject({ method: 'POST', url: '/api/control/restart', headers: UI });
    await app.inject({ method: 'POST', url: '/api/control/stop', headers: UI });
    await new Promise((r) => setTimeout(r, 250));
    expect(calls).toEqual(['restart', 'stop']);
  });

  it('holds file changes while paused and replays them on resume', async () => {
    const { watcher, repo } = setup();
    writeFileSync(
      sessionFile,
      line({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'hi' } }) +
        assistant('r1', [{ type: 'text', text: 'hello' }]),
    );
    watcher.pause();
    (watcher as unknown as { schedule(p: string): void }).schedule(sessionFile);
    await new Promise((r) => setTimeout(r, 30));
    await watcher.idle();
    expect(repo.getSnapshot('sess1')).toBeNull();
    watcher.resume();
    await new Promise((r) => setTimeout(r, 30));
    await watcher.idle();
    expect(repo.getSnapshot('sess1')!.items).toHaveLength(1);
  });
});
