import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  /** Claude Code data root that holds projects/. Read only. */
  claudeRoot: string;
  /** Where Agent ATO keeps its own database and token. */
  dataDir: string;
  host: string;
  port: number;
  /** Built web app to serve, if present. */
  webDir: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    claudeRoot: env.CLAUDE_ROOT ?? join(homedir(), '.claude'),
    dataDir: env.AGENT_ATO_DATA ?? join(homedir(), '.agent-ato'),
    host: '127.0.0.1',
    port: Number(env.AGENT_ATO_PORT ?? 4317),
    webDir: env.AGENT_ATO_WEB ?? null,
  };
}
