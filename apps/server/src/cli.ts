#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { hooksInstalled, installHooks, uninstallHooks } from './hooks-install.js';
import { EventHub } from './ingest/hub.js';
import { Watcher } from './ingest/watcher.js';
import { loadToken } from './security.js';
import { openDb } from './store/db.js';
import { Repo } from './store/repo.js';

const here = dirname(fileURLToPath(import.meta.url));
const clientPath = resolve(here, '..', 'hook-client.mjs');
const settingsPath = (root: string): string => join(root, 'settings.json');

async function start(): Promise<void> {
  const config = loadConfig();
  config.webDir ??= resolve(here, '..', '..', 'web', 'dist');
  const db = openDb(join(config.dataDir, 'agent-ato.db'));
  const repo = new Repo(db);
  const hub = new EventHub();
  const token = loadToken(config.dataDir);
  const app = buildApp({ config, repo, hub, token });
  const watcher = new Watcher(join(config.claudeRoot, 'projects'), repo, hub);

  await app.listen({ host: config.host, port: config.port });
  console.log(`Agent ATO listening on http://${config.host}:${config.port}`);
  console.log(`Watching ${join(config.claudeRoot, 'projects')} (read only)`);
  await watcher.start();
  console.log('Initial scan complete. Live updates on.');

  const shutdown = async (): Promise<void> => {
    await watcher.stop();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
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
  start().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (cmd === 'install-hooks') {
  const r = installHooks(settingsPath(config.claudeRoot), clientPath);
  console.log(`Added ${r.added} hook(s). Backup: ${settingsPath(config.claudeRoot)}.agent-ato.bak`);
} else if (cmd === 'uninstall-hooks') {
  console.log(`Removed ${uninstallHooks(settingsPath(config.claudeRoot)).removed} hook(s).`);
} else if (cmd === 'doctor') {
  doctor();
} else {
  console.error('Usage: agent-ato [start | install-hooks | uninstall-hooks | doctor]');
  process.exit(2);
}
