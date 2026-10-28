import type { Interaction } from '@agent-ato/shared';

export interface AlertConfig {
  toolErrors: boolean;
  secretAccess: boolean;
  highTokens: boolean;
  tokenThreshold: number;
  regex: string;
  browserNotifications: boolean;
}

export const DEFAULT_ALERTS: AlertConfig = {
  toolErrors: true,
  secretAccess: true,
  highTokens: true,
  tokenThreshold: 20000,
  regex: '',
  browserNotifications: false,
};

const SECRET_PATH = /(^|[\\/])\.env(\.|$|\b)|id_rsa|id_ed25519|\.pem\b|credentials|\.aws[\\/]|\.ssh[\\/]|secrets?\.(json|ya?ml|toml)/i;

export interface AlertHit {
  key: string;
  kind: 'error' | 'secret' | 'tokens' | 'regex';
  message: string;
  sessionId: string;
  index: number;
}

export function evaluate(it: Interaction, cfg: AlertConfig): AlertHit[] {
  const hits: AlertHit[] = [];
  const hit = (kind: AlertHit['kind'], message: string): void => {
    hits.push({ key: `${it.sessionId}:${it.id}:${kind}`, kind, message, sessionId: it.sessionId, index: it.index });
  };
  if (cfg.toolErrors && it.tools.some((t) => t.status === 'error')) hit('error', `Tool error in ${it.label}`);
  if (cfg.secretAccess && it.tools.some((t) => SECRET_PATH.test(t.input))) hit('secret', `Sensitive path touched: ${it.label}`);
  if (cfg.highTokens && it.outputTokens >= cfg.tokenThreshold) hit('tokens', `${it.outputTokens} output tokens in one response`);
  if (cfg.regex) {
    try {
      const re = new RegExp(cfg.regex, 'i');
      if (re.test(`${it.label}\n${it.narration}\n${it.tools.map((t) => t.input).join('\n')}`)) hit('regex', `Matched /${cfg.regex}/`);
    } catch {
      /* invalid user regex: ignore */
    }
  }
  return hits;
}
