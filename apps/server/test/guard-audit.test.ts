import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { decide, DEFAULT_CONFIG, GuardStore, type GuardRule } from '../src/guard.js';
import { EventHub } from '../src/ingest/hub.js';
import { Watcher } from '../src/ingest/watcher.js';
import { Audit } from '../src/store/audit.js';
import { openDb } from '../src/store/db.js';
import { Repo } from '../src/store/repo.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ato-ga-'));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const H = { host: 'localhost:4317' };
const UI = { ...H, 'x-agent-ato-ui': '1', 'content-type': 'application/json' };

function setup() {
  const db = openDb(':memory:');
  const repo = new Repo(db);
  const hub = new EventHub();
  const audit = new Audit(db);
  const guard = new GuardStore(db);
  const config: Config = { claudeRoot: tmp, dataDir: tmp, host: '127.0.0.1', port: 4317, webDir: null };
  const app = buildApp({ config, repo, hub, token: 'secret', audit, guard });
  return { db, repo, hub, audit, guard, app };
}

const pre = (command: string, tool = 'Bash') => ({
  hook_event_name: 'PreToolUse', session_id: 's1', tool_use_id: `t-${command.length}`, tool_name: tool, tool_input: { command },
});
const post = (app: ReturnType<typeof setup>['app'], body: object) =>
  app.inject({ method: 'POST', url: '/ingest/hook', headers: { ...H, 'x-agent-ato-token': 'secret' }, payload: body });

describe('audit log', () => {
  it('chains entries, ignores repeats of the same call, and detects edits and deletions', () => {
    const { db, audit } = setup();
    const e = { ts: 1, kind: 'call' as const, sessionId: 's', toolUseId: 't1', tool: 'Bash', target: 'ls' };
    expect(audit.append(e)).toBe(true);
    expect(audit.append(e)).toBe(false);
    audit.append({ ...e, toolUseId: 't2', ts: 2 });
    audit.append({ ...e, toolUseId: 't3', ts: 3 });
    expect(audit.count()).toBe(3);
    expect(audit.verify()).toMatchObject({ ok: true, checked: 3 });

    db.exec("UPDATE audit_log SET target = 'tampered' WHERE tool_use_id = 't2'");
    const bad = db.prepare("SELECT id FROM audit_log WHERE tool_use_id = 't2'").get() as { id: number };
    expect(audit.verify()).toMatchObject({ ok: false, brokenAt: bad.id });
  });

  it('notices rows removed from the end', () => {
    const { db, audit } = setup();
    audit.append({ ts: 1, kind: 'call', sessionId: 's', toolUseId: 'a' });
    audit.append({ ts: 2, kind: 'call', sessionId: 's', toolUseId: 'b' });
    db.exec("DELETE FROM audit_log WHERE tool_use_id = 'b'");
    expect(audit.verify().ok).toBe(false);
  });

  it('keeps one head after a restart', () => {
    const { db, audit } = setup();
    audit.append({ ts: 1, kind: 'call', sessionId: 's', toolUseId: 'a' });
    const reopened = new Audit(db);
    expect(reopened.headHash).toBe(audit.headHash);
    reopened.append({ ts: 2, kind: 'call', sessionId: 's', toolUseId: 'b' });
    expect(reopened.verify().ok).toBe(true);
  });

  it('records tool calls and results as the watcher ingests a transcript', () => {
    const { repo, hub, audit } = setup();
    const projects = join(tmp, 'projects');
    mkdirSync(join(projects, 'p'), { recursive: true });
    const file = join(projects, 'p', 'sess.jsonl');
    const usage = { input_tokens: 1, output_tokens: 1, output_tokens_details: { thinking_tokens: 0 } };
    const call = { type: 'assistant', requestId: 'r1', timestamp: '2026-01-01T00:00:01Z', message: { model: 'm', usage, content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'rm -rf build' } }] } };
    writeFileSync(file, `${JSON.stringify(call)}\n`);
    const watcher = new Watcher(projects, repo, hub, 0, audit);
    watcher.ingest(file);
    expect(audit.list({}).map((r) => r.kind)).toEqual(['call']);
    appendFileSync(file, `${JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'done' }] } })}\n`);
    watcher.ingest(file);
    const rows = audit.list({});
    expect(rows.map((r) => r.kind).sort()).toEqual(['call', 'result']);
    expect(rows[0]).toMatchObject({ tool: 'Bash', op: 'delete', risk: 'high' });
    expect(audit.verify().ok).toBe(true);
  });
});

describe('guard decisions', () => {
  const rules: GuardRule[] = [{ id: 1, name: 'no prod', kind: 'contains', pattern: 'prod-db', tool: null, action: 'deny', enabled: true }];
  const enforce = { ...DEFAULT_CONFIG, mode: 'enforce' as const };

  it('halt denies everything, even in mode off', () => {
    const d = decide({ ...DEFAULT_CONFIG, mode: 'off', halted: true }, [], 'Bash', { command: 'ls' });
    expect(d.decision).toBe('deny');
  });

  it('denies critical, asks on high, allows the rest when enforcing', () => {
    expect(decide(enforce, [], 'Bash', { command: 'rm -rf /' }).decision).toBe('deny');
    expect(decide(enforce, [], 'Bash', { command: 'git push origin main' }).decision).toBe('ask');
    expect(decide(enforce, [], 'Bash', { command: 'npm test' }).decision).toBe('allow');
  });

  it('applies user rules, only for the named tool when one is set', () => {
    expect(decide(enforce, rules, 'Bash', { command: 'psql prod-db' })).toMatchObject({ decision: 'deny', matched: 'rule: no prod' });
    const scoped: GuardRule[] = [{ ...rules[0]!, tool: 'Edit' }];
    expect(decide(enforce, scoped, 'Bash', { command: 'psql prod-db' }).decision).toBe('allow');
    const off: GuardRule[] = [{ ...rules[0]!, enabled: false }];
    expect(decide(enforce, off, 'Bash', { command: 'psql prod-db' }).decision).toBe('allow');
  });

  it('monitor mode allows but reports what it would have done', () => {
    const d = decide({ ...DEFAULT_CONFIG, mode: 'monitor' }, [], 'Bash', { command: 'rm -rf /' });
    expect(d).toMatchObject({ decision: 'allow', wouldHave: 'deny' });
  });
});

describe('guard over http', () => {
  it('answers PreToolUse with a permission decision only when it intervenes', async () => {
    const { app, guard, audit } = setup();
    // Default is monitor: nothing is returned, but the audit log notes what would have happened.
    let r = (await post(app, pre('rm -rf /'))).json();
    expect(r.hookSpecificOutput).toBeUndefined();
    expect(audit.list({ kind: 'guard' })[0]).toMatchObject({ risk: 'critical' });

    guard.setConfig({ mode: 'enforce' });
    r = (await post(app, pre('rm -rf /'))).json();
    expect(r.hookSpecificOutput).toMatchObject({ hookEventName: 'PreToolUse', permissionDecision: 'deny' });
    r = (await post(app, pre('git push'))).json();
    expect(r.hookSpecificOutput.permissionDecision).toBe('ask');
    r = (await post(app, pre('ls'))).json();
    expect(r.hookSpecificOutput).toBeUndefined();
  });

  it('never replies with allow, and ignores non-PreToolUse events', async () => {
    const { app, guard } = setup();
    guard.setConfig({ mode: 'enforce', halted: true });
    const r = (await post(app, { ...pre('rm -rf /'), hook_event_name: 'PostToolUse' })).json();
    expect(r.hookSpecificOutput).toBeUndefined();
  });

  it('halt from the UI blocks the next call', async () => {
    const { app } = setup();
    const res = await app.inject({ method: 'PUT', url: '/api/guard/config', headers: UI, payload: { halted: true } });
    expect(res.statusCode).toBe(200);
    const r = (await post(app, pre('ls'))).json();
    expect(r.hookSpecificOutput.permissionDecision).toBe('deny');
  });

  it('refuses changes without the UI header or with a foreign origin', async () => {
    const { app } = setup();
    expect((await app.inject({ method: 'PUT', url: '/api/guard/config', headers: { ...H, 'content-type': 'application/json' }, payload: { halted: true } })).statusCode).toBe(403);
    const foreign = await app.inject({ method: 'PUT', url: '/api/guard/config', headers: { ...UI, origin: 'https://evil.example' }, payload: { halted: true } });
    expect(foreign.statusCode).toBe(403);
  });

  it('validates rules and rejects bad regular expressions', async () => {
    const { app } = setup();
    const bad = await app.inject({ method: 'POST', url: '/api/guard/rules', headers: UI, payload: { name: 'x', kind: 'regex', pattern: '(', action: 'deny' } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: 'POST', url: '/api/guard/rules', headers: UI, payload: { name: 'x', kind: 'contains', pattern: 'secret', action: 'ask' } });
    expect(ok.json()).toMatchObject({ id: 1, tool: null, enabled: true });
    expect((await app.inject({ url: '/api/guard', headers: H })).json().rules).toHaveLength(1);
    const del = await app.inject({ method: 'DELETE', url: '/api/guard/rules/1', headers: { ...H, 'x-agent-ato-ui': '1' } });
    expect(del.statusCode).toBe(200);
  });
});
