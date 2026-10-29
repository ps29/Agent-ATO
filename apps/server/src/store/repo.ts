import { assessRisk, riskAtLeast, toOperation, type CrudOp, type Risk, type Interaction, type Operation, type Prompt, type SessionMeta } from '@agent-ato/shared';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { transaction } from './db.js';

export interface SessionRow {
  id: string;
  parentId: string | null;
  project: string;
  path: string;
  title: string | null;
  cwd: string | null;
  gitBranch: string | null;
  models: string[];
  startMs: number | null;
  endMs: number | null;
  updatedMs: number;
  nInteractions: number;
  nErrors: number;
  outTokens: number;
  compactions: number[];
}

export interface SessionSnapshot {
  session: SessionRow;
  prompts: Prompt[];
  items: Interaction[];
}

export interface HookRow {
  id: number;
  sessionId: string | null;
  event: string;
  toolName: string | null;
  toolUseId: string | null;
  ts: number;
  payload: unknown;
}

export interface SearchHit {
  sessionId: string;
  idx: number;
  snippet: string;
}

export interface OperationRow extends Operation {
  sessionId: string;
  index: number;
  ts: number;
  status: string;
  output: string;
  risk: Risk;
  riskReasons: string[];
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const toSession = (r: Row): SessionRow => ({
  id: r.id,
  parentId: r.parent_id,
  project: r.project,
  path: r.path,
  title: r.title,
  cwd: r.cwd,
  gitBranch: r.git_branch,
  models: JSON.parse(r.models),
  startMs: r.start_ms,
  endMs: r.end_ms,
  updatedMs: r.updated_ms,
  nInteractions: r.n_interactions,
  nErrors: r.n_errors,
  outTokens: r.out_tokens,
  compactions: JSON.parse(r.compactions),
});

/** Plain text that the full-text index should cover for one interaction. */
export function searchBody(it: Interaction): string {
  return [it.label, it.narration, ...it.tools.flatMap((t) => [t.name, t.input, t.output.slice(0, 1000)])]
    .join('\n');
}

export class Repo {
  private readonly upsertSession: StatementSync;
  private readonly upsertItem: StatementSync;
  private readonly getRid: StatementSync;
  private readonly delSearch: StatementSync;
  private readonly insSearch: StatementSync;

  constructor(private readonly db: DatabaseSync) {
    this.upsertSession = db.prepare(`
      INSERT INTO sessions (id, parent_id, project, path, title, cwd, git_branch, models, start_ms, end_ms,
        updated_ms, n_interactions, n_errors, out_tokens, compactions, prompts, file_size)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, cwd=excluded.cwd, git_branch=excluded.git_branch,
        models=excluded.models, start_ms=excluded.start_ms, end_ms=excluded.end_ms, path=excluded.path,
        updated_ms=excluded.updated_ms, n_interactions=excluded.n_interactions, n_errors=excluded.n_errors,
        out_tokens=excluded.out_tokens, compactions=excluded.compactions, prompts=excluded.prompts,
        file_size=excluded.file_size`);
    this.upsertItem = db.prepare(`
      INSERT INTO interactions (session_id, idx, label, tags, has_error, start_ms, data, rid) VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(session_id, idx) DO UPDATE SET label=excluded.label, tags=excluded.tags,
        has_error=excluded.has_error, start_ms=excluded.start_ms, data=excluded.data, rid=excluded.rid`);
    // FTS rows are addressed by rowid; filtering an FTS table on UNINDEXED columns is a full scan.
    this.getRid = db.prepare('SELECT rid FROM interactions WHERE session_id = ? AND idx = ?');
    this.delSearch = db.prepare('DELETE FROM search WHERE rowid = ?');
    this.insSearch = db.prepare('INSERT INTO search (session_id, idx, body) VALUES (?,?,?)');
  }

  /** Persist a session row and the interactions that changed. */
  saveSession(args: {
    id: string;
    parentId: string | null;
    project: string;
    path: string;
    meta: SessionMeta;
    prompts: Prompt[];
    items: Interaction[];
    changed: Interaction[];
    updatedMs: number;
    fileSize: number;
  }): void {
    const { meta, items } = args;
    transaction(this.db, () => {
      this.upsertSession.run(
        args.id, args.parentId, args.project, args.path, meta.title, meta.cwd, meta.gitBranch,
        JSON.stringify(meta.models), meta.startMs, meta.endMs, args.updatedMs, items.length,
        items.reduce((n, i) => n + (i.hasError ? 1 : 0), 0),
        items.reduce((n, i) => n + i.outputTokens, 0),
        JSON.stringify(meta.compactions), JSON.stringify(args.prompts), args.fileSize,
      );
      for (const it of args.changed) {
        const old = this.getRid.get(args.id, it.index) as Row | undefined;
        if (old?.rid) this.delSearch.run(old.rid);
        const rid = Number(this.insSearch.run(args.id, it.index, searchBody(it)).lastInsertRowid);
        this.upsertItem.run(
          args.id, it.index, it.label, it.tags.join(''), it.hasError ? 1 : 0, it.startMs, JSON.stringify(it), rid,
        );
      }
    });
  }

  listSessions(limit = 500): SessionRow[] {
    const rows = this.db.prepare('SELECT * FROM sessions ORDER BY updated_ms DESC LIMIT ?').all(limit) as Row[];
    return rows.map(toSession);
  }

  /** Size of the transcript when it was last fully ingested, or null if unknown. */
  getFileSize(id: string): number | null {
    const r = this.db.prepare('SELECT file_size FROM sessions WHERE id = ?').get(id) as Row | undefined;
    return r ? Number(r.file_size) : null;
  }

  getSession(id: string): SessionRow | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined;
    return r ? toSession(r) : null;
  }

  getSnapshot(id: string): SessionSnapshot | null {
    const r = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Row | undefined;
    if (!r) return null;
    const items = (this.db.prepare('SELECT data FROM interactions WHERE session_id = ? ORDER BY idx').all(id) as Row[])
      .map((x) => JSON.parse(x.data) as Interaction);
    return { session: toSession(r), prompts: JSON.parse(r.prompts), items };
  }

  getInteraction(sessionId: string, idx: number): Interaction | null {
    const r = this.db.prepare('SELECT data FROM interactions WHERE session_id = ? AND idx = ?').get(sessionId, idx) as Row | undefined;
    return r ? (JSON.parse(r.data) as Interaction) : null;
  }

  /**
   * Tool calls across all sessions as CRUD operations, newest first. Scans interaction rows in
   * batches until enough matching operations are found, so a rare filter still pages correctly.
   */
  operations(f: { ops?: CrudOp[]; sessionId?: string; q?: string; minRisk?: Risk; before?: number; limit?: number }): { items: OperationRow[]; next: number | null } {
    const limit = Math.min(f.limit ?? 100, 300);
    const needle = f.q?.toLowerCase();
    const items: OperationRow[] = [];
    let cursor = f.before ?? Number.MAX_SAFE_INTEGER;
    for (let scanned = 0; scanned < 5000 && items.length < limit; ) {
      const rows = this.db
        .prepare(`SELECT session_id, idx, start_ms, data FROM interactions
          WHERE start_ms < ? ${f.sessionId ? 'AND session_id = ?' : ''} ORDER BY start_ms DESC LIMIT 200`)
        .all(...(f.sessionId ? [cursor, f.sessionId] : [cursor])) as Row[];
      if (!rows.length) return { items, next: null };
      scanned += rows.length;
      for (const r of rows) {
        cursor = r.start_ms ?? 0;
        const it = JSON.parse(r.data) as Interaction;
        for (const t of it.tools) {
          const o = toOperation(t);
          if (!o || (f.ops?.length && !f.ops.includes(o.op))) continue;
          if (needle && !`${o.target}
${o.code}`.toLowerCase().includes(needle)) continue;
          const risk = assessRisk(t);
          if (f.minRisk && !riskAtLeast(risk.level, f.minRisk)) continue;
          items.push({
            ...o, sessionId: r.session_id, index: r.idx, ts: r.start_ms ?? 0, status: t.status, output: t.output.slice(0, 4000),
            risk: risk.level, riskReasons: risk.reasons,
          });
        }
      }
      if (rows.length < 200) return { items, next: null };
    }
    return { items, next: items.length ? cursor : null };
  }

  /** Time of the newest hook event, or null if none has arrived. */
  lastHookMs(): number | null {
    const r = this.db.prepare('SELECT MAX(ts) AS t FROM hook_events').get() as { t: number | null };
    return r.t;
  }

  search(q: string, limit = 50): SearchHit[] {
    const match = q
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => `"${w.replace(/"/g, '""')}"`)
      .join(' ');
    if (!match) return [];
    const rows = this.db
      .prepare(
        `SELECT session_id, idx, snippet(search, 2, '[', ']', '…', 12) AS snip
         FROM search WHERE search MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(match, limit) as Row[];
    return rows.map((r) => ({ sessionId: r.session_id, idx: Number(r.idx), snippet: r.snip }));
  }

  /** Filtered log of interactions across sessions. */
  log(f: { tag?: string; errorsOnly?: boolean; sessionId?: string; limit?: number; before?: number }): Row[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.tag) { where.push('tags LIKE ?'); args.push(`%${f.tag}%`); }
    if (f.errorsOnly) where.push('has_error = 1');
    if (f.sessionId) { where.push('session_id = ?'); args.push(f.sessionId); }
    if (f.before) { where.push('start_ms < ?'); args.push(f.before); }
    const sql = `SELECT session_id, idx, label, tags, has_error, start_ms FROM interactions
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY start_ms DESC LIMIT ?`;
    return this.db.prepare(sql).all(...args, Math.min(f.limit ?? 200, 1000)) as Row[];
  }

  stats(): { tagCounts: Record<string, number>; perDay: Row[]; totals: Row } {
    const tagCounts: Record<string, number> = { D: 0, R: 0, W: 0, E: 0 };
    for (const r of this.db.prepare('SELECT tags, COUNT(*) c FROM interactions GROUP BY tags').all() as Row[]) {
      for (const t of String(r.tags)) if (t in tagCounts) tagCounts[t]! += Number(r.c);
    }
    const perDay = this.db
      .prepare(
        `SELECT date(start_ms/1000,'unixepoch') day, COUNT(*) n, SUM(has_error) errors
         FROM interactions WHERE start_ms IS NOT NULL GROUP BY day ORDER BY day DESC LIMIT 60`,
      )
      .all() as Row[];
    const totals = this.db
      .prepare('SELECT COUNT(*) sessions, SUM(n_interactions) interactions, SUM(out_tokens) outTokens, SUM(n_errors) errors FROM sessions')
      .get() as Row;
    return { tagCounts, perDay, totals };
  }

  addHook(h: { sessionId: string | null; event: string; toolName: string | null; toolUseId: string | null; ts: number; payload: unknown }): number {
    const r = this.db
      .prepare('INSERT INTO hook_events (session_id, event, tool_name, tool_use_id, ts, payload) VALUES (?,?,?,?,?,?)')
      .run(h.sessionId, h.event, h.toolName, h.toolUseId, h.ts, JSON.stringify(h.payload));
    return Number(r.lastInsertRowid);
  }

  hooks(sessionId: string, limit = 500): HookRow[] {
    const rows = this.db
      .prepare('SELECT * FROM hook_events WHERE session_id = ? ORDER BY id DESC LIMIT ?')
      .all(sessionId, limit) as Row[];
    return rows.map((r) => ({
      id: r.id, sessionId: r.session_id, event: r.event, toolName: r.tool_name,
      toolUseId: r.tool_use_id, ts: r.ts, payload: JSON.parse(r.payload),
    }));
  }
}
