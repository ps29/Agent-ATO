import type { Interaction, Prompt, SessionMeta } from '@agent-ato/shared';

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
  | { type: 'hook'; sessionId: string | null; event: string; toolName: string | null; toolUseId: string | null; ts: number };

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
  search: (text: string) => get<SearchHit[]>(`/api/search?${q({ q: text })}`),
  log: (f: { tag?: string; errors?: boolean; session?: string }) =>
    get<LogRow[]>(`/api/log?${q({ tag: f.tag, errors: f.errors ? '1' : undefined, session: f.session })}`),
  stats: () => get<Stats>('/api/stats'),
  hooks: (id: string) => get<HookRow[]>(`/api/hooks?${q({ id })}`),
  memory: (project: string) => get<{ files: { name: string; content: string }[] }>(`/api/memory?${q({ project })}`),
  exportUrl: (id: string, format: 'json' | 'csv' | 'md') => `/api/export?${q({ id, format })}`,
};
