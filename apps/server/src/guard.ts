import { assessRisk, riskAtLeast, type Risk } from '@agent-ato/shared';
import type { DatabaseSync } from 'node:sqlite';

export type GuardMode = 'off' | 'monitor' | 'enforce';
export type RuleAction = 'deny' | 'ask';

export interface GuardConfig {
  /** off: never intervene. monitor: log what would have happened. enforce: deny or ask. */
  mode: GuardMode;
  /** Emergency stop: deny every tool call until released. Applies in any mode. */
  halted: boolean;
  /** Deny calls rated at least this risk. null disables. */
  denyAtLeast: Risk | null;
  /** Make Claude Code ask you for calls rated at least this risk. null disables. */
  askAtLeast: Risk | null;
}

export const DEFAULT_CONFIG: GuardConfig = { mode: 'monitor', halted: false, denyAtLeast: 'critical', askAtLeast: 'high' };

export interface GuardRule {
  id: number;
  name: string;
  /** contains: case-insensitive substring. regex: case-insensitive regular expression. */
  kind: 'contains' | 'regex';
  pattern: string;
  /** Limit to one tool name, or null for any. */
  tool: string | null;
  action: RuleAction;
  enabled: boolean;
}

export type NewRule = Omit<GuardRule, 'id'>;

export interface Decision {
  /** `allow` means Agent ATO does not intervene; Claude Code's own permission flow still applies. */
  decision: 'allow' | 'deny' | 'ask';
  reason: string;
  risk: Risk;
  matched: string | null;
  /** In monitor mode: what enforce mode would have done. */
  wouldHave?: 'deny' | 'ask';
}

const KEY = 'guard.config';
const MAX_TEXT = 20_000;

export class GuardStore {
  constructor(private readonly db: DatabaseSync) {}

  config(): GuardConfig {
    const r = this.db.prepare('SELECT v FROM kv WHERE k = ?').get(KEY) as { v: string } | undefined;
    try {
      return { ...DEFAULT_CONFIG, ...(r ? (JSON.parse(r.v) as Partial<GuardConfig>) : {}) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  setConfig(patch: Partial<GuardConfig>): GuardConfig {
    const next = { ...this.config(), ...patch };
    this.db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(KEY, JSON.stringify(next));
    return next;
  }

  rules(): GuardRule[] {
    return (this.db.prepare('SELECT * FROM guard_rules ORDER BY id').all() as Record<string, unknown>[]).map(toRule);
  }

  addRule(r: NewRule): GuardRule {
    const res = this.db
      .prepare('INSERT INTO guard_rules (name, kind, pattern, tool, action, enabled, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(r.name, r.kind, r.pattern, r.tool, r.action, r.enabled ? 1 : 0, Date.now());
    return { ...r, id: Number(res.lastInsertRowid) };
  }

  updateRule(id: number, p: Partial<NewRule>): GuardRule | null {
    const cur = this.rules().find((r) => r.id === id);
    if (!cur) return null;
    const n = { ...cur, ...p };
    this.db
      .prepare('UPDATE guard_rules SET name = ?, kind = ?, pattern = ?, tool = ?, action = ?, enabled = ? WHERE id = ?')
      .run(n.name, n.kind, n.pattern, n.tool, n.action, n.enabled ? 1 : 0, id);
    return n;
  }

  deleteRule(id: number): boolean {
    return Number(this.db.prepare('DELETE FROM guard_rules WHERE id = ?').run(id).changes) > 0;
  }
}

const toRule = (r: Record<string, unknown>): GuardRule => ({
  id: Number(r.id), name: String(r.name), kind: r.kind === 'regex' ? 'regex' : 'contains', pattern: String(r.pattern),
  tool: r.tool === null ? null : String(r.tool), action: r.action === 'ask' ? 'ask' : 'deny', enabled: r.enabled === 1,
});

/** True when the regex source compiles. Used to reject bad rules up front. */
export function validRegex(src: string): boolean {
  try {
    new RegExp(src, 'i');
    return true;
  } catch {
    return false;
  }
}

/** The text a rule is matched against: the command, the file path, or the raw input. */
function subject(tool: string, input: Record<string, unknown>): string {
  const main = input.command ?? input.file_path ?? input.notebook_path ?? input.url ?? input.pattern;
  return String(typeof main === 'string' ? main : JSON.stringify(input)).slice(0, MAX_TEXT);
}

const matches = (r: GuardRule, tool: string, text: string): boolean => {
  if (!r.enabled || (r.tool && r.tool !== tool)) return false;
  if (r.kind === 'contains') return text.toLowerCase().includes(r.pattern.toLowerCase());
  try {
    return new RegExp(r.pattern, 'i').test(text);
  } catch {
    return false;
  }
};

/** Decide what to do with one PreToolUse call. Pure: callers log and relay the result. */
export function decide(cfg: GuardConfig, rules: GuardRule[], tool: string, input: Record<string, unknown>): Decision {
  const risk = assessRisk({ name: tool, input: JSON.stringify(input) });
  const base = { risk: risk.level, matched: null as string | null };

  if (cfg.halted) {
    return { ...base, decision: 'deny', reason: 'Agent ATO: all tool calls are halted. Release the halt in the dashboard to continue.' };
  }
  if (cfg.mode === 'off') return { ...base, decision: 'allow', reason: '' };

  const text = subject(tool, input);
  let want: Decision | null = null;
  const rule = rules.find((r) => matches(r, tool, text));
  if (rule) {
    want = { ...base, decision: rule.action, matched: `rule: ${rule.name}`, reason: `Agent ATO rule "${rule.name}" matched.` };
  } else if (cfg.denyAtLeast && riskAtLeast(risk.level, cfg.denyAtLeast)) {
    want = { ...base, decision: 'deny', matched: 'risk', reason: `Agent ATO blocked a ${risk.level}-risk action: ${risk.reasons.join('; ')}.` };
  } else if (cfg.askAtLeast && riskAtLeast(risk.level, cfg.askAtLeast)) {
    want = { ...base, decision: 'ask', matched: 'risk', reason: `Agent ATO flagged a ${risk.level}-risk action: ${risk.reasons.join('; ')}.` };
  }
  if (!want) return { ...base, decision: 'allow', reason: '' };
  if (cfg.mode === 'monitor') return { ...want, decision: 'allow', wouldHave: want.decision as 'deny' | 'ask' };
  return want;
}
