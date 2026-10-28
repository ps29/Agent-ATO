import { TranscriptParser } from '@agent-ato/shared';
import chokidar, { type FSWatcher } from 'chokidar';
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { basename, relative, sep } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
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

  constructor(
    private readonly projectsRoot: string,
    private readonly repo: Repo,
    private readonly hub: EventHub,
    private readonly debounceMs = 150,
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

  /** Test hook: wait for queued ingest work. */
  idle(): Promise<void> {
    return this.queue;
  }

  private schedule(path: string): void {
    if (!identify(this.projectsRoot, path)) return;
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

