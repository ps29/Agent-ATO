import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const MIGRATIONS: string[] = [
  `
  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    parent_id TEXT,
    project TEXT NOT NULL,
    path TEXT NOT NULL,
    title TEXT,
    cwd TEXT,
    git_branch TEXT,
    models TEXT NOT NULL DEFAULT '[]',
    start_ms INTEGER,
    end_ms INTEGER,
    updated_ms INTEGER NOT NULL DEFAULT 0,
    n_interactions INTEGER NOT NULL DEFAULT 0,
    n_errors INTEGER NOT NULL DEFAULT 0,
    out_tokens INTEGER NOT NULL DEFAULT 0,
    compactions TEXT NOT NULL DEFAULT '[]',
    prompts TEXT NOT NULL DEFAULT '[]',
    file_size INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX sessions_updated ON sessions(updated_ms DESC);
  CREATE TABLE interactions (
    session_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    label TEXT NOT NULL,
    tags TEXT NOT NULL,
    has_error INTEGER NOT NULL DEFAULT 0,
    start_ms INTEGER,
    data TEXT NOT NULL,
    rid INTEGER,
    PRIMARY KEY (session_id, idx)
  ) WITHOUT ROWID;
  CREATE INDEX interactions_start ON interactions(start_ms);
  CREATE VIRTUAL TABLE search USING fts5(session_id UNINDEXED, idx UNINDEXED, body);
  CREATE TABLE hook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT,
    event TEXT NOT NULL,
    tool_name TEXT,
    tool_use_id TEXT,
    ts INTEGER NOT NULL,
    payload TEXT NOT NULL
  );
  CREATE INDEX hook_session ON hook_events(session_id, ts);
  `,
  `
  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    kind TEXT NOT NULL,
    session_id TEXT,
    tool_use_id TEXT,
    tool TEXT,
    op TEXT,
    risk TEXT,
    target TEXT,
    detail TEXT,
    prev_hash TEXT NOT NULL,
    hash TEXT NOT NULL
  );
  CREATE UNIQUE INDEX audit_once ON audit_log(session_id, tool_use_id, kind)
    WHERE tool_use_id IS NOT NULL AND kind IN ('call', 'result');
  CREATE INDEX audit_ts ON audit_log(ts);
  CREATE INDEX audit_risk ON audit_log(risk);
  CREATE TABLE guard_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    pattern TEXT NOT NULL,
    tool TEXT,
    action TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_ms INTEGER NOT NULL
  );
  CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
  `,
];

export function openDb(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;');
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return db;
}

export function transaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
