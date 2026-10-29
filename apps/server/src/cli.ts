#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { hooksInstalled, installHooks, uninstallHooks } from './hooks-install.js';
import type { Interaction } from '@agent-ato/shared';
import { GuardStore } from './guard.js';
import { EventHub } from './ingest/hub.js';
import { auditEntries, Watcher } from './ingest/watcher.js';
import { loadToken } from './security.js';
import { Audit } from './store/audit.js';
import { openDb } from './store/db.js';
import { Repo } from './store/repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = resolve(here, '..', 'hook-client.mjs');
const RESTART_CODE = 75;
const settingsPath = (root: string): string => join(root, 'settings.json');

async function start(): Promise<void> {
  const config = loadConfig();
  config.webDir ??= resolve(here, '..', '..', 'web', 'dist');
  const db = openDb(join(config.dataDir, 'agent-ato.db'));
  const repo = new Repo(db);
  const hub = new EventHub();
  const token = loadToken(config.dataDir);
  const audit = new Audit(db);
  const guard = new GuardStore(db);
  const watcher = new Watcher(join(config.claudeRoot, 'projects'), repo, hub, 150, audit);
  let leave = (_code: number): void => undefined;
  const app = buildApp({
    config, repo, hub, token, audit, guard,
    control: {
      paused: () => watcher.paused,
      pause: () => watcher.pause(),
      resume: () => watcher.resume(),
      stop: () => leave(0),
      restart: () => leave(RESTART_CODE),
      supervised: process.env.AGENT_ATO_SUPERVISED === '1',
    },
  });

  await app.listen({ host: config.host, port: config.port });
  console.log(`Agent ATO listening on http://${config.host}:${config.port}`);
  console.log(`Watching ${join(config.claudeRoot, 'projects')} (read only)`);
  await watcher.start();
  console.log('Initial scan complete. Live updates on.');

  let leaving = false;
  leave = (code: number): void => {
    if (leaving) return;
    leaving = true;
    void (async () => {
      await watcher.stop();
      await app.close();
      db.close();
      process.exit(code);
    })();
  };
  process.on('SIGINT', () => leave(0));
  process.on('SIGTERM', () => leave(0));
}

/** Run the server as a child and start it again whenever it exits with the restart code. */
function supervise(): void {
  const run = (): void => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'serve'], {
      stdio: 'inherit',
      env: { ...process.env, AGENT_ATO_SUPERVISED: '1' },
    });
    child.on('exit', (code) => {
      if (code === RESTART_CODE) {
        console.log('Restarting…');
        run();
      } else process.exit(code ?? 0);
    });
  };
  // Ctrl+C reaches the child too; the supervisor just waits for it to exit.
  process.on('SIGINT', () => undefined);
  run();
}

/** Add audit entries for sessions stored before the audit log existed. Safe to repeat. */
function auditBackfill(): void {
  const cfg = loadConfig();
  const db = openDb(join(cfg.dataDir, 'agent-ato.db'));
  const audit = new Audit(db);
  const sessions = db.prepare('SELECT DISTINCT session_id FROM interactions').all() as { session_id: string }[];
  let added = 0;
  for (const { session_id } of sessions) {
    const rows = db.prepare('SELECT data FROM interactions WHERE session_id = ? ORDER BY idx').all(session_id) as { data: string }[];
    added += audit.appendMany(auditEntries(session_id, rows.map((r) => JSON.parse(r.data) as Interaction)));
  }
  console.log('Added ' + added + ' audit entries from ' + sessions.length + ' sessions. Total: ' + audit.count() + '.');
  db.close();
}

function doctor(): void {
  const config = loadConfig();
  const major = Number(process.versions.node.split('.')[0]);
  const check = (ok: boolean, msg: string): void => console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`);
  check(major >= 22, `Node ${process.versions.node} (need >= 22.13)`);
  check(existsSync(join(config.claudeRoot, 'projects')), `transcripts at ${join(config.claudeRoot, 'projects')}`);
  check(existsSync(join(config.dataDir, 'agent-ato.db')), `database at ${config.dataDir}`);
  check(existsSync(clientPath), `hook client at ${clientPath}`);
  console.log(`info hooks installed: ${hooksInstalled(settingsPath(config.claudeRoot))}`);
}

const cmd = process.argv[2];
const config = loadConfig();
if (cmd === 'start' || cmd === undefined) {
  supervise();
} else if (cmd === 'serve') {
  start().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (cmd === 'install-hooks') {
  const r = installHooks(settingsPath(config.claudeRoot), clientPath);
  console.log(`Added ${r.added} hook(s). Backup: ${settingsPath(config.claudeRoot)}.agent-ato.bak`);
} else if (cmd === 'uninstall-hooks') {
  console.log(`Removed ${uninstallHooks(settingsPath(config.claudeRoot)).removed} hook(s).`);
} else if (cmd === 'audit-backfill') {
  auditBackfill();
} else if (cmd === 'doctor') {
  doctor();
} else {
  console.error('Usage: agent-ato [start | serve | install-hooks | uninstall-hooks | audit-backfill | doctor]');
  process.exit(2);
}
