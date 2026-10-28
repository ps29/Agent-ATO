import { TAG_NAMES, TAG_ORDER } from '@agent-ato/shared';
import { useEffect, useState } from 'react';
import { api, type Stats as StatsData } from '../api';
import { fmt } from '../timeline/math';

export function Stats() {
  const [s, setS] = useState<StatsData | null>(null);
  useEffect(() => { api.stats().then(setS).catch(() => setS(null)); }, []);
  if (!s) return <div className="muted">Loading…</div>;
  const total = TAG_ORDER.reduce((n, t) => n + (s.tagCounts[t] ?? 0), 0) || 1;
  const days = [...s.perDay].reverse();
  const max = Math.max(1, ...days.map((d) => d.n));
  return (
    <>
      <div className="card tabs" style={{ gap: 24 }}>
        <div className="stat"><b>{s.totals.sessions}</b><span>sessions</span></div>
        <div className="stat"><b>{fmt(s.totals.interactions ?? 0)}</b><span>interactions</span></div>
        <div className="stat"><b>{fmt(s.totals.outTokens ?? 0)}</b><span>output tokens</span></div>
        <div className="stat"><b>{s.totals.errors ?? 0}</b><span>tool errors</span></div>
      </div>
      <div className="card">
        <b>Where the agent spends its steps</b>
        <div style={{ display: 'flex', height: 22, borderRadius: 6, overflow: 'hidden', margin: '8px 0' }}>
          {TAG_ORDER.map((t) => (<div key={t} title={`${TAG_NAMES[t]}: ${s.tagCounts[t]}`} style={{ width: `${((s.tagCounts[t] ?? 0) / total) * 100}%`, background: `var(--tag-${t.toLowerCase()})` }} />))}
        </div>
        <div className="legend">{TAG_ORDER.map((t) => (<span key={t}><i style={{ background: `var(--tag-${t.toLowerCase()})` }} />{TAG_NAMES[t]} {s.tagCounts[t]} ({Math.round(((s.tagCounts[t] ?? 0) / total) * 100)}%)</span>))}</div>
        <div className="muted">An interaction with several tags counts once in each.</div>
      </div>
      <div className="card">
        <b>Interactions per day</b>
        <div className="bars" role="img" aria-label="Interactions per day">
          {days.map((d) => (<div key={d.day} title={`${d.day}: ${d.n} interactions, ${d.errors} errors`} style={{ height: `${(d.n / max) * 100}%` }} />))}
        </div>
        <div className="muted">{days[0]?.day} → {days.at(-1)?.day}</div>
      </div>
    </>
  );
}
