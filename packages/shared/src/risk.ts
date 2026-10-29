import { shellOp } from './crud.js';

export type Risk = 'low' | 'medium' | 'high' | 'critical';
export const RISK_ORDER: Risk[] = ['low', 'medium', 'high', 'critical'];

export interface RiskAssessment {
  level: Risk;
  /** Why each rule fired, most severe first. Empty for low risk. */
  reasons: string[];
}

export const riskAtLeast = (level: Risk, min: Risk): boolean => RISK_ORDER.indexOf(level) >= RISK_ORDER.indexOf(min);
export const maxRisk = (a: Risk, b: Risk): Risk => (riskAtLeast(a, b) ? a : b);

interface Rule {
  level: Risk;
  reason: string;
  test: RegExp;
}

/** Paths whose modification can change security or tool behaviour. */
const SENSITIVE_PATH =
  /(^|[\\/])(\.ssh|\.aws|\.gnupg|\.kube)([\\/]|$)|(^|[\\/])\.env(\.[\w.-]+)?$|id_rsa|id_ed25519|authorized_keys|credentials|\.npmrc$|\.pypirc$|\.netrc$|[\\/]\.claude[\\/]settings(\.local)?\.json$|[\\/]windows[\\/]|[\\/]system32[\\/]|^\/etc\/|\.bashrc$|\.zshrc$|\.profile$|profile\.ps1$|[\\/]drivers[\\/]etc[\\/]hosts$/i;

const CI_PATH = /(^|[\\/])\.github[\\/]workflows[\\/]|(^|[\\/])dockerfile$|(^|[\\/])\.gitlab-ci\.yml$/i;

/** Command rules. Each is matched against the whole command text, so a quoted mention can match too: treat results as a warning, not proof. */
const SHELL_RULES: Rule[] = [
  { level: 'critical', reason: 'Force-deletes a root, home or drive', test: /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*|--recursive\s+--force|--force\s+--recursive)\s+(\/|~|\$HOME|\*|[a-z]:[\\/]?)(\s|$)/i },
  { level: 'critical', reason: 'Force-deletes a root, home or drive', test: /remove-item[^|;&]*-recurse[^|;&]*-force[^|;&]*\s([a-z]:\\?|~|\$home|\*)(\s|$)/i },
  { level: 'critical', reason: 'Formats or overwrites a disk', test: /\bformat\s+[a-z]:|\bmkfs(\.\w+)?\b|\bdd\s+[^|;&]*\bof=\/dev\/|\bdiskpart\b|\bclear-disk\b/i },
  { level: 'critical', reason: 'Downloads and runs code in one step', test: /(curl|wget)[^|;&]*\|\s*(sudo\s+)?(ba|z)?sh\b|(iwr|irm|invoke-webrequest|invoke-restmethod)[^|;&]*\|\s*(iex|invoke-expression)\b/i },
  { level: 'critical', reason: 'Drops or truncates database data', test: /\bdrop\s+(table|database|schema)\b|\btruncate\s+table\b/i },
  { level: 'high', reason: 'Deletes recursively', test: /(^|[\s;&|(])(rm|rmdir|rd|del|erase)\s+[^|;&]*(-\w*r\w*|\/s\b|--recursive)\b|remove-item[^|;&]*-recurse/i },
  { level: 'high', reason: 'Rewrites or discards git history or work', test: /\bgit\s+(reset\s+--hard|clean\s+-\w*f|checkout\s+--\s|restore\s+\.|branch\s+-D|filter-branch|reflog\s+expire)/i },
  { level: 'high', reason: 'Pushes to a remote', test: /\bgit\s+push\b/i },
  { level: 'high', reason: 'Changes system configuration', test: /\breg\s+(add|delete|import)\b|set-executionpolicy|schtasks\s+\/create|register-scheduledtask|netsh\s+advfirewall|\bbcdedit\b|\bsc(\.exe)?\s+(create|delete|config)\b|new-service|set-itemproperty\s+[^|;&]*hk(lm|cu):/i },
  { level: 'high', reason: 'Runs with elevated privileges', test: /(^|[\s;&|(])sudo\s|\brunas\b|start-process[^|;&]*-verb\s+runas/i },
  { level: 'high', reason: 'Shuts down or restarts the machine', test: /\bshutdown\b|restart-computer|stop-computer|\breboot\b/i },
  { level: 'high', reason: 'Publishes a package', test: /\b(npm|yarn|pnpm)\s+publish\b|\btwine\s+upload\b|\bcargo\s+publish\b|\bgh\s+release\s+create\b/i },
  { level: 'high', reason: 'Opens permissions wide', test: /\bchmod\s+-R\s+0?7[0-7][0-7]\b|\bicacls\b[^|;&]*\/grant[^|;&]*everyone/i },
  { level: 'medium', reason: 'Deletes files', test: /(^|[\s;&|(])(rm|del|erase|unlink)\s|remove-item\b/i },
  { level: 'medium', reason: 'Stops processes', test: /\b(kill|killall|pkill|taskkill|stop-process)\b/i },
  { level: 'medium', reason: 'Installs software', test: /\bpip3?\s+install\b|\b(npm|pnpm|yarn)\s+(i|install|add)\b[^|;&]*\s(-g|--global)\b|\b(choco|winget|scoop|brew)\s+install\b|\bapt(-get)?\s+install\b/i },
  { level: 'medium', reason: 'Makes a network request', test: /(^|[\s;&|(])(curl|wget)\s|invoke-webrequest|invoke-restmethod|(^|[\s;&|(])(iwr|irm)\s/i },
  { level: 'medium', reason: 'Moves or merges git history', test: /\bgit\s+(rebase|merge|cherry-pick|revert|stash\s+drop)\b/i },
];

const MCP_ACTION = /(send|post|delete|remove|create|update|publish|reply|forward|share|trash|write|upload)/i;

function parse(input: string): Record<string, unknown> {
  try {
    const v: unknown = JSON.parse(input);
    if (v && typeof v === 'object') return v as Record<string, unknown>;
  } catch {
    /* truncated input: fall back to scanning the raw text below */
  }
  return {};
}

/**
 * Rate how much damage a tool call could do. Rules read the command text only; they cannot see
 * what a script does or what the shell expands. Use as a highlight, not as a security boundary.
 */
export function assessRisk(tool: { name: string; input: string }): RiskAssessment {
  const inp = parse(tool.input);
  const hits: Rule[] = [];
  const add = (level: Risk, reason: string): number => hits.push({ level, reason, test: /$^/ });
  const path = String(inp.file_path ?? inp.notebook_path ?? '');

  if (tool.name === 'Bash' || tool.name === 'PowerShell') {
    const cmd = String(inp.command ?? tool.input);
    for (const r of SHELL_RULES) if (r.test.test(cmd)) hits.push(r);
    const writes = ['create', 'update', 'delete'].includes(shellOp(cmd));
    if (SENSITIVE_PATH.test(cmd)) add(writes ? 'high' : 'medium', writes ? 'Modifies a sensitive path' : 'Reads a sensitive path');
  } else if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(tool.name)) {
    if (SENSITIVE_PATH.test(path)) add('high', 'Modifies a sensitive file');
    else if (CI_PATH.test(path)) add('medium', 'Changes build or deploy configuration');
  } else if (tool.name === 'Read' || tool.name === 'NotebookRead') {
    if (SENSITIVE_PATH.test(path)) add('medium', 'Reads a sensitive file');
  } else if (tool.name.startsWith('mcp__') && MCP_ACTION.test(tool.name.split('__').pop() ?? '')) {
    add('medium', 'Performs an action in an external service');
  }

  if (!hits.length) return { level: 'low', reasons: [] };
  hits.sort((a, b) => RISK_ORDER.indexOf(b.level) - RISK_ORDER.indexOf(a.level));
  return { level: hits[0]!.level, reasons: [...new Set(hits.map((h) => h.reason))] };
}
