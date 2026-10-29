import { createHash } from 'node:crypto';
import type { DatabaseSync, StatementSync } from 'node:sqlite';
import { transaction } from './db.js';

export type AuditKind = 'call' | 'result' | 'guard' | 'control';

export interface AuditEntry {
  ts: number;
  kind: AuditKind;
  sessionId?: string | null;
  toolUseId?: string | null;
  tool?: string | null;
  op?: string | null;
  risk?: string | null;
  target?: string | null;
  /** Free-form JSON string: code, status, decision, reasons. Capped on write. */
  detail?: string | null;
}

export interface AuditRow {
  id: number;
  ts: number;
  kind: AuditKind;
  session_id: string | null;
  tool_use_id: string | null;
  tool: string | null;
  op: string | null;
  risk: string | null;
  target: string | null;
  detail: string | null;
  prev_hash: string;
  hash: string;
}

export const GENESIS = '0'.repeat(64);
const DETAIL_CAP = 4000;

/** The fields that go into a row's hash, in a fixed order. */
const material = (r: Pick<AuditRow, 'ts' | 'kind' | 'session_id' | 'tool_use_id' | 'tool' | 'op' | 'risk' | 'target' | 'detail'>): string =>
  JSON.stringify([r.ts, r.kind, r.session_id, r.tool_use_id, r.tool, r.op, r.risk, r.target, r.detail]);

const hashOf = (prev: string, row: Parameters<typeof material>[0]): string =>
  createHash('sha256').update(`${prev}|${material(row)}`).digest('hex');

/**
 * Append-only activity log. Each row's hash covers the previous row's hash, so editing or deleting
 * a row in the middle breaks every hash after it. That makes tampering detectable by `verify()`;
 * it does not stop someone who can rewrite the whole file, so note the head hash somewhere else
 * if you need stronger guarantees.
 */
export class Audit {
  private head: string;
  private readonly insert: StatementSync;

  constructor(private readonly db: DatabaseSync) {
    const last = db.prepare('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1').get() as { hash: string } | undefined;
    this.head = last?.hash ?? GENESIS;
    this.insert = db.prepare(
      `INSERT OR IGNORE INTO audit_log (ts, kind, session_id, tool_use_id, tool, op, risk, target, detail, prev_hash, hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
  }

  get headHash(): string {
    return this.head;
  }

  /** Append one entry. Returns false when an entry for the same call and kind already exists. */
  append(e: AuditEntry): boolean {
    const row = {
      ts: Math.round(e.ts), kind: e.kind, session_id: e.sessionId ?? null, tool_use_id: e.toolUseId ?? null,
      tool: e.tool ?? null, op: e.op ?? null, risk: e.risk ?? null, target: e.target?.slice(0, 500) ?? null,
      detail: e.detail ? e.detail.slice(0, DETAIL_CAP) : null,
    };
    const hash = hashOf(this.head, row);
    const r = this.insert.run(
      row.ts, row.kind, row.session_id, row.tool_use_id, row.tool, row.op, row.risk, row.target, row.detail, this.head, hash,
    );
    if (Number(r.changes) === 0) return false;
    this.head = hash;
    return true;
  }

  /** Append several entries in one transaction (initial scans insert thousands). */
  appendMany(entries: AuditEntry[]): number {
    if (!entries.length) return 0;
    return transaction(this.db, () => entries.reduce((n, e) => n + (this.append(e) ? 1 : 0), 0));
  }

  list(f: { kind?: string; risk?: string; sessionId?: string; q?: string; before?: number; limit?: number }): AuditRow[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (f.kind) { where.push('kind = ?'); args.push(f.kind); }
    if (f.risk) {
      const order = ['low', 'medium', 'high', 'critical'];
      const keep = order.slice(order.indexOf(f.risk));
      if (keep.length && keep.length < order.length) {
        where.push(`risk IN (${keep.map(() => '?').join(',')})`);
        args.push(...keep);
      }
    }
    if (f.sessionId) { where.push('session_id = ?'); args.push(f.sessionId); }
    if (f.q) {
      where.push("(target LIKE ? ESCAPE '!' OR detail LIKE ? ESCAPE '!' OR tool LIKE ? ESCAPE '!')");
      const like = `%${f.q.replace(/[!%_]/g, (c) => `!${c}`)}%`;
      args.push(like, like, like);
    }
    if (f.before) { where.push('id < ?'); args.push(f.before); }
    const sql = `SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`;
    return this.db.prepare(sql).all(...args, Math.min(f.limit ?? 100, 500)) as unknown as AuditRow[];
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) c FROM audit_log').get() as { c: number }).c;
  }

  /** Recompute the whole chain. `brokenAt` is the first row whose link or hash does not match. */
  verify(): { ok: boolean; checked: number; brokenAt: number | null; head: string } {
    let prev = GENESIS;
    let checked = 0;
    for (const r of this.db.prepare('SELECT * FROM audit_log ORDER BY id').iterate() as Iterable<unknown>) {
      const row = r as AuditRow;
      if (row.prev_hash !== prev || row.hash !== hashOf(prev, row)) return { ok: false, checked, brokenAt: row.id, head: this.head };
      prev = row.hash;
      checked++;
    }
    return { ok: prev === this.head, checked, brokenAt: null, head: this.head };
  }
}
