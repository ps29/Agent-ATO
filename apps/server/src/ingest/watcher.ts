import { assessRisk, toOperation, TranscriptParser, type Interaction } from '@agent-ato/shared';
import chokidar, { type FSWatcher } from 'chokidar';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { basename, relative, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Audit, AuditEntry } from '../store/audit.js';
import type { Repo } from '../store/repo.js';
import type { EventHub } from './hub.js';

interface Stream {
  id: string;
  parentId: string | null;
  project: string;
  path: string;
  parser: TranscriptParser;
  decoder: StringDecoder;
  offset: number;
  promptCount: number;
}

/**
 * Identify a transcript from its path under projects/:
 *   <project>/<session>.jsonl                      -> main session
 *   <project>/<session>/subagents/<agent>.jsonl    -> sub-agent of <session>
 */
export function identify(projectsRoot: string, file: string): { id: string; parentId: string | null; project: string } | null {
  const parts = relative(projectsRoot, file).split(sep);
  if (!file.endsWith('.jsonl')) return null;
  const project = parts[0];
  if (!project) return null;
  if (parts.length === 2) return { id: basename(parts[1]!, '.jsonl'), parentId: null, project };
  if (parts.length === 4 && parts[2] === 'subagents') {
    const parent = parts[1]!;
    return { id: `${parent}/${basename(parts[3]!, '.jsonl')}`, parentId: parent, project };
  }
  return null;
}

export class Watcher {
  private readonly streams = new Map<string, Stream>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private fsw: FSWatcher | null = null;
  private queue: Promise<void> = Promise.resolve();
  private held = new Set<string>();
  private halted = false;

  constructor(
    private readonly projectsRoot: string,
    private readonly repo: Repo,
    private readonly hub: EventHub,
    private readonly debounceMs = 150,
    private readonly audit?: Audit,
  ) {}

  /** Resolves once the initial scan has been ingested. */
  async start(): Promise<void> {
    this.fsw = chokidar.watch(this.projectsRoot, { ignoreInitial: false, depth: 4, persistent: true });
    const ready = new Promise<void>((resolve) => this.fsw!.once('ready', () => resolve()));
    const onFile = (p: string): void => this.schedule(p);
    this.fsw.on('add', onFile).on('change', onFile);
    await ready;
    await this.queue;
  }

  async stop(): Promise<void> {
    for (const t of this.timers.values()) clearTimeout(t);
    await this.fsw?.close();
  }

  get paused(): boolean {
    return this.halted;
  }

  /** Stop ingesting. File events are remembered and replayed on resume, so nothing is lost. */
  pause(): void {
    this.halted = true;
    for (const [p, t] of this.timers) {
      clearTimeout(t);
      this.held.add(p);
    }
    this.timers.clear();
  }

  resume(): void {
    this.halted = false;
    const paths = [...this.held];
    this.held.clear();
    for (const p of paths) this.schedule(p);
  }

  /** Test hook: wait for queued ingest work. */
  idle(): Promise<void> {
    return this.queue;
  }

  private schedule(path: string): void {
    if (!identify(this.projectsRoot, path)) return;
    if (this.halted) {
      this.held.add(path);
      return;
    }
    clearTimeout(this.timers.get(path));
    this.timers.set(
      path,
      setTimeout(() => {
        this.timers.delete(path);
        this.queue = this.queue.then(() => this.ingest(path)).catch((e) => console.error('ingest failed', path, e));
      }, this.debounceMs),
    );
  }

  /** Read newly appended bytes from a transcript and push changes to the store and hub. */
  ingest(path: string): void {
    const ident = identify(this.projectsRoot, path);
    if (!ident) return;
    let size: number;
    let mtime: number;
    try {
      const st = statSync(path);
      size = st.size;
      mtime = st.mtimeMs;
    } catch {
      return;
    }
    let s = this.streams.get(path);
    if (s && size < s.offset) {
      this.streams.delete(path); // truncated or replaced: start over
      s = undefined;
    }
    // Unchanged since the last run: no need to parse again. A later append re-parses from zero.
    if (!s && this.repo.getFileSize(ident.id) === size && size > 0) return;
    if (!s) {
      s = {
        ...ident, path, parser: new TranscriptParser(ident.id), decoder: new StringDecoder('utf8'),
        offset: 0, promptCount: 0,
      };
      this.streams.set(path, s);
    }
    if (size === s.offset) return;

    const fd = openSync(path, 'r');
    const changed = new Set<number>();
    try {
      const buf = Buffer.allocUnsafe(1 << 20);
      while (s.offset < size) {
        const n = readSync(fd, buf, 0, Math.min(buf.length, size - s.offset), s.offset);
        if (n <= 0) break;
        s.offset += n;
        for (const i of s.parser.feed(s.decoder.write(buf.subarray(0, n)))) changed.add(i);
      }
    } finally {
      closeSync(fd);
    }

    const { parser } = s;
    const items = [...changed].map((i) => parser.items[i]!);
    this.repo.saveSession({
      id: s.id, parentId: s.parentId, project: s.project, path, meta: parser.meta,
      prompts: parser.prompts, items: parser.items, changed: items, updatedMs: Math.round(mtime), fileSize: s.offset,
    });
    if (this.audit) this.audit.appendMany(auditEntries(s.id, items));
    const row = this.repo.getSession(s.id);
    if (row) this.hub.publish({ type: 'session', session: row });
    if (items.length) {
      const promptsChanged = parser.prompts.length !== s.promptCount;
      s.promptCount = parser.prompts.length;
      this.hub.publish({
        type: 'interactions', sessionId: s.id, items, meta: parser.meta,
        ...(promptsChanged ? { prompts: parser.prompts } : {}),
      });
    }
  }
}


/** One audit "call" entry per tool call, plus a "result" entry once it has finished. Safe to repeat: duplicates are ignored. */
export function auditEntries(sessionId: string, items: Interaction[]): AuditEntry[] {
  const out: AuditEntry[] = [];
  for (const it of items) {
    for (const t of it.tools) {
      const op = toOperation(t);
      const risk = assessRisk(t);
      const base = { sessionId, toolUseId: t.id, tool: t.name, op: op?.op ?? null, risk: risk.level, target: op?.target || t.label };
      const ts = it.startMs ?? Date.now();
      out.push({ ...base, ts, kind: 'call', detail: JSON.stringify({ code: (op?.code ?? t.input).slice(0, 2000), language: op?.language ?? 'json', reasons: risk.reasons }) });
      if (t.status !== 'pending') {
        out.push({ ...base, ts: it.endMs ?? ts, kind: 'result', detail: JSON.stringify({ status: t.status, output: t.output.slice(0, 500) }) });
      }
    }
  }
  return out;
}
