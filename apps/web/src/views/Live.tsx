import { TAG_NAMES, TAG_ORDER } from '@agent-ato/shared';
import { useEffect, useMemo, useState } from 'react';
import { api, type HookRow } from '../api';
import { AlertsPanel } from '../components/AlertsPanel';
import { FeedList } from '../components/FeedList';
import { Detail } from '../components/Detail';
import { useStore } from '../store';
import { Timeline } from '../timeline/Timeline';
import { fmt, fmtDuration } from '../timeline/math';

export function Live() {
  const { items, prompts, meta, selectedId, selectedIndex, followLatest, hookPending, sessions } = useStore();
  const setSelectedIndex = useStore((s) => s.setSelectedIndex);
  const setFollow = useStore((s) => s.setFollow);
  const [hooks, setHooks] = useState<HookRow[]>([]);
  const session = sessions.find((s) => s.id === selectedId);

  // Hook rows for the open interaction. Refreshed when a different cell is opened.
  useEffect(() => {
    if (selectedId && selectedIndex !== null) api.hooks(selectedId).then(setHooks).catch(() => setHooks([]));
  }, [selectedId, selectedIndex]);

  const totals = useMemo(() => {
    const tags: Record<string, number> = { D: 0, R: 0, W: 0, E: 0 };
    let calls = 0, errors = 0, out = 0, tool = 0;
    for (const it of items) {
      for (const t of it.tags) tags[t]!++;
      calls += it.tools.length;
      errors += it.tools.filter((t) => t.status === 'error').length;
      out += it.outputTokens;
      tool += it.toolResultTokensEst;
    }
    return { tags, calls, errors, out, tool };
  }, [items]);

  const pendingIds = useMemo(() => new Set(Object.keys(hookPending)), [hookPending]);
  const step = (d: 1 | -1): void => {
    if (selectedIndex !== null) setSelectedIndex(Math.min(items.length - 1, Math.max(0, selectedIndex + d)));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
      else if (e.key === 'Escape') setSelectedIndex(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!selectedId) return <div className="muted">Pick a session on the left.</div>;

  return (
    <>
      <div className="card">
        <div className="tabs">
          <b>{meta?.title ?? session?.title ?? selectedId}</b>
          {session?.active && <span className="badge"><span className="dot live" /> active</span>}
          <span className="spacer" />
          <label><input type="checkbox" checked={followLatest} onChange={(e) => setFollow(e.target.checked)} /> follow newest active session</label>
          {(['json', 'csv', 'md'] as const).map((f) => (<a key={f} href={api.exportUrl(selectedId, f)}><button>{f.toUpperCase()}</button></a>))}
        </div>
        <div className="muted">
          {meta?.cwd} {meta?.gitBranch ? `· ${meta.gitBranch}` : ''} {meta?.models.length ? `· ${meta.models.join(', ')}` : ''}
          {meta?.startMs && meta.endMs ? ` · ${fmtDuration(meta.endMs - meta.startMs)}` : ''}
        </div>
        <div className="tabs" style={{ gap: 18, marginTop: 6 }}>
          <div className="stat"><b>{items.length}</b><span>interactions</span></div>
          <div className="stat"><b>{totals.calls}</b><span>tool calls</span></div>
          <div className="stat"><b style={{ color: totals.errors ? 'var(--err)' : undefined }}>{totals.errors}</b><span>errors</span></div>
          <div className="stat"><b>{fmt(totals.out)}</b><span>output tokens</span></div>
          <div className="stat"><b>≈{fmt(totals.tool)}</b><span>tool-result tokens</span></div>
          {TAG_ORDER.map((t) => (<div key={t} className="stat"><b style={{ color: `var(--tag-${t.toLowerCase()})` }}>{totals.tags[t]}</b><span>{TAG_NAMES[t]}</span></div>))}
        </div>
      </div>

      <div className="card">
        {items.length ? (
          <Timeline items={items} prompts={prompts} compactions={meta?.compactions ?? []} pendingIds={pendingIds}
            active={Boolean(session?.active)} follow={followLatest} selected={selectedIndex} onSelect={setSelectedIndex} />
        ) : (<div className="muted">Loading…</div>)}
      </div>

      <div className="card">
        <FeedList sessionId={selectedId} compact onOpen={(_, idx) => setSelectedIndex(idx)} />
      </div>

      <AlertsPanel />

      {selectedIndex !== null && (
        <Detail items={items} index={selectedIndex} prompts={prompts} hooks={hooks} onClose={() => setSelectedIndex(null)} onStep={step} />
      )}
    </>
  );
}
