import type { Interaction, Operation, Prompt, ReportKind, Risk, SessionMeta } from '@agent-ato/shared';

export interface SessionRow {
  id: string;
  parentId: string | null;
  project: string;
  title: string | null;
  cwd: string | null;
  gitBranch: string | null;
  models: string[];
  startMs: number | null;
  endMs: number | null;
  updatedMs: number;
  nInteractions: number;
  nErrors: number;
  outTokens: number;
  compactions: number[];
  active: boolean;
}

export interface Snapshot {
  session: SessionRow;
  prompts: Prompt[];
  items: Interaction[];
}

export interface ControlState {
  paused: boolean;
  supervised: boolean;
  available: boolean;
}

export interface OperationRow extends Operation {
  sessionId: string;
  index: number;
  ts: number;
  status: string;
  output: string;
  risk: Risk;
  riskReasons: string[];
}

export type GuardMode = 'off' | 'monitor' | 'enforce';

export interface GuardConfig {
  mode: GuardMode;
  halted: boolean;
  denyAtLeast: Risk | null;
  askAtLeast: Risk | null;
}

export interface GuardRule {
  id: number;
  name: string;
  kind: 'contains' | 'regex';
  pattern: string;
  tool: string | null;
  action: 'deny' | 'ask';
  enabled: boolean;
}

export interface GuardState {
  config: GuardConfig;
  rules: GuardRule[];
  lastHookMs: number | null;
}

export interface AuditRow {
  id: number;
  ts: number;
  kind: 'call' | 'result' | 'guard' | 'control';
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

export interface VerifyResult {
  ok: boolean;
  checked: number;
  brokenAt: number | null;
  head: string;
}

export interface HookRow {
  id: number;
  event: string;
  toolName: string | null;
  toolUseId: string | null;
  ts: number;
}

export interface SearchHit {
  sessionId: string;
  idx: number;
  snippet: string;
}

export interface LogRow {
  session_id: string;
  idx: number;
  label: string;
  tags: string;
  has_error: number;
  start_ms: number | null;
}

export interface Stats {
  tagCounts: Record<string, number>;
  perDay: { day: string; n: number; errors: number }[];
  totals: { sessions: number; interactions: number; outTokens: number; errors: number };
}

export type ServerEvent =
  | { type: 'session'; session: SessionRow }
  | { type: 'interactions'; sessionId: string; items: Interaction[]; meta: SessionMeta; prompts?: Prompt[] }
  | { type: 'control'; paused: boolean }
  | { type: 'guard'; halted: boolean; mode: string }
  | { type: 'hook'; sessionId: string | null; event: string; toolName: string | null; toolUseId: string | null; ts: number };

/** State-changing call. The custom header makes the browser block it from other origins. */
async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-agent-ato-ui': '1' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

const post = <T,>(url: string): Promise<T> => send<T>('POST', url);

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return (await res.json()) as T;
}

const q = (o: Record<string, string | undefined>): string =>
  new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => e[1] !== undefined)).toString();

export const api = {
  sessions: () => get<SessionRow[]>('/api/sessions'),
  session: (id: string) => get<Snapshot>(`/api/session?${q({ id })}`),
  interaction: (session: string, idx: number) => get<Interaction>(`/api/interaction?${q({ session, idx: String(idx) })}`),
  search: (text: string) => get<SearchHit[]>(`/api/search?${q({ q: text })}`),
  log: (f: { tag?: string; errors?: boolean; session?: string }) =>
    get<LogRow[]>(`/api/log?${q({ tag: f.tag, errors: f.errors ? '1' : undefined, session: f.session })}`),
  audit: (f: { kind?: string; risk?: string; q?: string; session?: string; before?: number }) =>
    get<{ rows: AuditRow[]; total: number; head: string }>(
      `/api/audit?${q({ kind: f.kind, risk: f.risk, q: f.q, session: f.session, before: f.before === undefined ? undefined : String(f.before) })}`,
    ),
  auditVerify: () => get<VerifyResult>('/api/audit/verify'),
  guard: () => get<GuardState>('/api/guard'),
  putGuard: (patch: Partial<GuardConfig>) => send<GuardConfig>('PUT', '/api/guard/config', patch),
  addRule: (r: Omit<GuardRule, 'id'>) => send<GuardRule>('POST', '/api/guard/rules', r),
  patchRule: (id: number, p: Partial<Omit<GuardRule, 'id'>>) => send<GuardRule>('PATCH', `/api/guard/rules/${id}`, p),
  deleteRule: (id: number) => send<{ ok: boolean }>('DELETE', `/api/guard/rules/${id}`),
  reportUrl: (id: string, kind: ReportKind) => `/api/report?${q({ id, kind })}`,
  operations: (f: { op?: string; q?: string; session?: string; risk?: string; before?: number }) =>
    get<{ items: OperationRow[]; next: number | null }>(
      `/api/operations?${q({ op: f.op, q: f.q, session: f.session, risk: f.risk, before: f.before === undefined ? undefined : String(f.before) })}`,
    ),
  controlState: () => get<ControlState>('/api/control'),
  control: (action: 'pause' | 'resume' | 'stop' | 'restart') => post<unknown>(`/api/control/${action}`),
  stats: () => get<Stats>('/api/stats'),
  hooks: (id: string) => get<HookRow[]>(`/api/hooks?${q({ id })}`),
  memory: (project: string) => get<{ files: { name: string; content: string }[] }>(`/api/memory?${q({ project })}`),
  exportUrl: (id: string, format: 'json' | 'csv' | 'md') => `/api/export?${q({ id, format })}`,
};
