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
