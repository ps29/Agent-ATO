import type { SessionRow } from './api';

/** A readable session name: its title, else the project folder plus a short id, else the short id. */
export function sessionName(s: Pick<SessionRow, 'id' | 'title' | 'project' | 'cwd'>): string {
  if (s.title) return s.title;
  const base = (s.cwd ?? s.project ?? '').split(/[\\/]/).filter(Boolean).pop();
  return base ? `${base} · ${s.id.slice(0, 6)}` : s.id.slice(0, 8);
}

/** The last two folders of a path, so long project paths stay short. The full path goes in a tooltip. */
export function shortPath(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : p;
}
