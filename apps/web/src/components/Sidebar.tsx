import { useMemo, useState } from 'react';
import type { SessionRow } from '../api';
import { useStore } from '../store';
import { fmt } from '../timeline/math';

const ago = (ms: number): string => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 129600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

function Row({ s, child }: { s: SessionRow; child?: boolean }) {
  const selectedId = useStore((st) => st.selectedId);
  const select = useStore((st) => st.select);
  const setFollow = useStore((st) => st.setFollow);
  const name = s.title ?? s.id.slice(0, 8);
  return (
    <div className={`session ${selectedId === s.id ? 'sel' : ''} ${child ? 'child' : ''}`}
      onClick={() => { setFollow(false); void select(s.id); }} title={s.cwd ?? s.project}>
      <div className="t"><span className={`dot ${s.active ? 'live' : ''}`} /> {child ? `agent ${s.id.split('/')[1]?.slice(-6)}` : name}</div>
      <div className="m">
        <span>{s.nInteractions} steps</span><span>{fmt(s.outTokens)} out</span>
        {s.nErrors > 0 && <span style={{ color: 'var(--err)' }}>{s.nErrors} err</span>}
        <span>{ago(s.updatedMs)}</span>
      </div>
    </div>
  );
}

export function Sidebar() {
  const sessions = useStore((s) => s.sessions);
  const [q, setQ] = useState('');
  const { roots, kids } = useMemo(() => {
    const kids = new Map<string, SessionRow[]>();
    for (const s of sessions) if (s.parentId) kids.set(s.parentId, [...(kids.get(s.parentId) ?? []), s]);
    const needle = q.toLowerCase();
    const roots = sessions.filter((s) => !s.parentId && (!needle || `${s.title ?? ''} ${s.project} ${s.id}`.toLowerCase().includes(needle)));
    return { roots, kids };
  }, [sessions, q]);

  return (
    <nav className="sidebar" aria-label="Sessions">
      <input type="search" placeholder="Filter sessions" value={q} onChange={(e) => setQ(e.target.value)} />
      {roots.map((s) => (
        <div key={s.id}>
          <Row s={s} />
          {(kids.get(s.id) ?? []).map((c) => (<Row key={c.id} s={c} child />))}
        </div>
      ))}
      {!roots.length && <div className="muted">No sessions found.</div>}
    </nav>
  );
}
