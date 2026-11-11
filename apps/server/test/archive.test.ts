import { appendFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventHub } from '../src/ingest/hub.js';
import { Watcher } from '../src/ingest/watcher.js';
import { Archive } from '../src/store/archive.js';
import { Audit } from '../src/store/audit.js';
import { openDb } from '../src/store/db.js';
import { Repo } from '../src/store/repo.js';

let tmp: string;
let projects: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'ato-ar-'));
  projects = join(tmp, 'projects');
  mkdirSync(join(projects, 'p'), { recursive: true });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const restored = (dir: string, rel: string): string => gunzipSync(readFileSync(join(dir, `${rel}.gz`))).toString('utf8');

describe('archive', () => {
  it('keeps an exact, growing copy and only adds new bytes', () => {
    const db = openDb(':memory:');
    const archive = new Archive(join(tmp, 'archive'), db);
    const file = join(projects, 'p', 's.jsonl');
    writeFileSync(file, '{"a":1}\n{"b":2}\n');
    expect(archive.catchUp(file, 'p/s.jsonl')).toBe(16);
    expect(archive.catchUp(file, 'p/s.jsonl')).toBe(0);
    appendFileSync(file, '{"c":3}\n{"partial"');
    expect(archive.catchUp(file, 'p/s.jsonl')).toBe(18);
    expect(restored(archive.dir, 'p/s.jsonl')).toBe(readFileSync(file, 'utf8'));
  });

  it('survives restarts because progress is stored in the database', () => {
    const db = openDb(':memory:');
    const file = join(projects, 'p', 's.jsonl');
    writeFileSync(file, 'one\n');
    new Archive(join(tmp, 'archive'), db).catchUp(file, 'p/s.jsonl');
    appendFileSync(file, 'two\n');
    const again = new Archive(join(tmp, 'archive'), db);
    expect(again.catchUp(file, 'p/s.jsonl')).toBe(4);
    expect(restored(again.dir, 'p/s.jsonl')).toBe('one\ntwo\n');
  });

  it('keeps what it has after Claude Code deletes the transcript', () => {
    const db = openDb(':memory:');
    const archive = new Archive(join(tmp, 'archive'), db);
    const file = join(projects, 'p', 's.jsonl');
    writeFileSync(file, 'precious\n');
    archive.catchUp(file, 'p/s.jsonl');
    rmSync(file);
    expect(archive.catchUp(file, 'p/s.jsonl')).toBe(0);
    expect(restored(archive.dir, 'p/s.jsonl')).toBe('precious\n');
  });

  it('keeps the old copy when a transcript is replaced by a shorter one', () => {
    const db = openDb(':memory:');
    const archive = new Archive(join(tmp, 'archive'), db);
    const file = join(projects, 'p', 's.jsonl');
    writeFileSync(file, 'a long first version\n');
    archive.catchUp(file, 'p/s.jsonl');
    writeFileSync(file, 'short\n');
    archive.catchUp(file, 'p/s.jsonl');
    expect(restored(archive.dir, 'p/s.jsonl')).toBe('short\n');
    const kept = readdirSync(join(archive.dir, 'p')).filter((f) => f !== 's.jsonl.gz');
    expect(kept).toHaveLength(1);
    expect(gunzipSync(readFileSync(join(archive.dir, 'p', kept[0]!))).toString('utf8')).toBe('a long first version\n');
  });

  it('archives every transcript found under the projects folder', async () => {
    const db = openDb(':memory:');
    const archive = new Archive(join(tmp, 'archive'), db);
    writeFileSync(join(projects, 'p', 'one.jsonl'), 'x\n');
    mkdirSync(join(projects, 'p', 'one', 'subagents'), { recursive: true });
    writeFileSync(join(projects, 'p', 'one', 'subagents', 'agent-1.jsonl'), 'y\n');
    writeFileSync(join(projects, 'p', 'notes.txt'), 'ignored\n');
    const watcher = new Watcher(projects, new Repo(db), new EventHub(), 0, new Audit(db), archive);
    await watcher.archiveAll();
    expect(restored(archive.dir, 'p/one.jsonl')).toBe('x\n');
    expect(restored(archive.dir, 'p/one/subagents/agent-1.jsonl')).toBe('y\n');
  });
});

describe('audit of prompts and commentary', () => {
  it('records the user prompt and finished commentary once, even when re-read', () => {
    const db = openDb(':memory:');
    const audit = new Audit(db);
    const file = join(projects, 'p', 'sess.jsonl');
    const usage = { input_tokens: 1, output_tokens: 1, output_tokens_details: { thinking_tokens: 0 } };
    const lines = [
      { type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'please list files' } },
      { type: 'assistant', requestId: 'r1', timestamp: '2026-01-01T00:00:01Z', message: { model: 'm', usage, content: [
        { type: 'text', text: 'Listing the directory.' }, { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } },
      ] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'a.txt' }] } },
    ];
    writeFileSync(file, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
    const watcher = new Watcher(projects, new Repo(db), new EventHub(), 0, audit);
    watcher.ingest(file);
    const kinds = () => audit.list({ limit: 50 }).map((r) => r.kind).sort();
    expect(kinds()).toEqual(['call', 'message', 'prompt', 'result']);
    const before = audit.count();
    const fresh = new Watcher(projects, new Repo(db), new EventHub(), 0, audit);
    fresh.ingest(file);
    expect(audit.count()).toBe(before);
    expect(audit.verify().ok).toBe(true);
    const prompt = audit.list({ kind: 'prompt' })[0]!;
    expect(JSON.parse(prompt.detail!)).toMatchObject({ text: 'please list files' });
  });
});
