import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const HOOK_EVENTS = [
  'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SubagentStop', 'SessionStart', 'Notification',
] as const;

/** Marker present in every command this tool adds, so removal never touches user hooks. */
export const MARKER = 'agent-ato-managed';

type Settings = { hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ type: string; command: string }> }>> } & Record<string, unknown>;

const isOurs = (h: { command?: string }): boolean => Boolean(h.command?.includes(MARKER));

function read(path: string): Settings {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Settings) : {};
}

function write(path: string, s: Settings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(s, null, 2)}\n`);
}

/** Add Agent ATO hooks to a Claude Code settings.json. Idempotent; backs the file up first. */
export function installHooks(settingsPath: string, clientPath: string): { added: number } {
  const s = read(settingsPath);
  if (existsSync(settingsPath)) copyFileSync(settingsPath, `${settingsPath}.agent-ato.bak`);
  s.hooks ??= {};
  const command = `node "${clientPath}" --${MARKER}`;
  let added = 0;
  for (const ev of HOOK_EVENTS) {
    const groups = (s.hooks[ev] ??= []);
    if (groups.some((g) => g.hooks?.some(isOurs))) continue;
    groups.push({ matcher: '*', hooks: [{ type: 'command', command }] });
    added++;
  }
  write(settingsPath, s);
  return { added };
}

/** Remove only the hooks this tool added. */
export function uninstallHooks(settingsPath: string): { removed: number } {
  if (!existsSync(settingsPath)) return { removed: 0 };
  const s = read(settingsPath);
  let removed = 0;
  for (const ev of Object.keys(s.hooks ?? {})) {
    const groups = s.hooks![ev]!;
    for (const g of groups) {
      const before = g.hooks?.length ?? 0;
      g.hooks = g.hooks?.filter((h) => !isOurs(h));
      removed += before - (g.hooks?.length ?? 0);
    }
    s.hooks![ev] = groups.filter((g) => (g.hooks?.length ?? 0) > 0);
    if (!s.hooks![ev]!.length) delete s.hooks![ev];
  }
  if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
  write(settingsPath, s);
  return { removed };
}

export function hooksInstalled(settingsPath: string): boolean {
  return Object.values(read(settingsPath).hooks ?? {}).some((gs) => gs.some((g) => g.hooks?.some(isOurs)));
}
