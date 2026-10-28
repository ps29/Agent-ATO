import type { Interaction } from '@agent-ato/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useStore, type FeedRow } from '../store';
import { fmt } from '../timeline/math';

interface Props {
  /** Show only this session. Omit for every session. */
  sessionId?: string | null;
  compact?: boolean;
  onOpen: (sessionId: string, index: number) => void;
}

const STATUS_LABEL: Record<FeedRow['status'], string> = { running: 'running', ok: 'ok', error: 'error' };

// A stable colour per session so interleaved sessions stay readable.
const hue = (id: string): number => {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};

/** Details of one interaction, fetched when a row is opened and refreshed when its status changes. */
function Expanded({ row, onOpen }: { row: FeedRow; onOpen: () => void }) {
  const [it, setIt] = useState<Interaction | null>(null);
  const [err, setErr] = useState(false);
  useEffect(() => {
    let live = true;
    api.interaction(row.sessionId, row.index).then((d) => live && (setIt(d), setErr(false))).catch(() => live && setErr(true));
    return () => { live = false; };
  }, [row.sessionId, row.index, row.status, row.outputTokens]);

  if (err) return <div className="feedexp muted">Details are no longer available.</div>;
  if (!it) return <div className="feedexp muted">Loading…</div>;
  return (
    <div className="feedexp" onClick={(e) => e.stopPropagation()}>
      {it.narration.trim() && (<><div className="muted">Agent said</div><pre>{it.narration}</pre></>)}
      <div className="muted">
        {it.thinkingTokens > 0 ? `Thought for ${fmt(it.thinkingTokens)} tokens${it.thinkingMs ? ` (${Math.round(it.thinkingMs / 1000)}s)` : ''}; the text is not stored by Claude Code. ` : ''}
        {it.model ?? ''}
      </div>
      {it.tools.map((t) => (
        <div key={t.id} className={`tool ${t.status === 'error' ? 'error' : ''}`}>
          <div className="tabs">
            <b>{t.name}</b>
            <span className={`badge ${t.status === 'error' ? 'err' : ''}`}>{t.status}</span>
          </div>
          <pre>{t.input}</pre>
          <div className="muted">Result</div>
          <pre>{t.output || (t.status === 'pending' ? 'waiting for result…' : '(empty)')}</pre>
        </div>
      ))}
      {!it.tools.length && !it.narration.trim() && <div className="muted">No visible text or tool calls (thinking only).</div>}
      <button onClick={onOpen}>Open full detail</button>
    </div>
  );
}

export function FeedList({ sessionId, compact, onOpen }: Props) {
  const feed = useStore((s) => s.feed);
  const sessions = useStore((s) => s.sessions);
  const [paused, setPaused] = useState(false);
  const [tag, setTag] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string): void => setOpen((o) => { const n = new Set(o); if (!n.delete(id)) n.add(id); return n; });
  const frozen = useRef<FeedRow[]>([]);
  const box = useRef<HTMLDivElement>(null);

  // While paused, keep showing the rows that were on screen when pause was pressed.
  if (!paused) frozen.current = feed;
  const source = paused ? frozen.current : feed;

  const rows = useMemo(
    () =>
      source
        .filter((r) => (!sessionId || r.sessionId === sessionId) && (!tag || r.tags.includes(tag)) && (!errorsOnly || r.status === 'error'))
        .slice(0, compact ? 60 : 300),
    [source, sessionId, tag, errorsOnly, compact],
  );

  // Keep the newest row in view unless the user scrolled down to read.
  useEffect(() => {
    const el = box.current;
    if (el && !paused && el.scrollTop < 40) el.scrollTop = 0;
  }, [rows, paused]);

  const names = useMemo(() => new Map(sessions.map((s) => [s.id, s.title ?? s.id.slice(0, 8)])), [sessions]);
  const running = rows.filter((r) => r.status === 'running').length;

  return (
    <div>
      <div className="tabs" style={{ marginBottom: 8 }}>
        <b>Live feed</b> <span className="muted">click a row to expand</span>
        <span className="badge"><span className={`dot ${paused ? '' : 'live'}`} /> {paused ? 'paused' : 'streaming'}</span>
        {running > 0 && <span className="badge">{running} running</span>}
        <button onClick={() => setPaused(!paused)}>{paused ? 'Resume' : 'Pause'}</button>
        <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag filter">
          <option value="">all tags</option><option value="D">Discovery</option><option value="R">Reading</option>
          <option value="W">Writing</option><option value="E">Execution</option>
        </select>
        <label><input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> errors only</label>
        <span className="muted">{rows.length} shown · newest first</span>
      </div>
      <div ref={box} className="feedlist" style={{ maxHeight: compact ? 260 : 'calc(100vh - 190px)' }}>
        {rows.map((r) => (
          <div key={r.key} className={`feedrow ${r.status}`} onClick={() => toggle(`${r.sessionId}:${r.index}`)}>
            <span className="muted">{open.has(`${r.sessionId}:${r.index}`) ? '▾' : '▸'}</span>
            <span className="muted feedtime">{r.ts ? new Date(r.ts).toLocaleTimeString() : ''}</span>
            {!sessionId && (
              <span className="feedsess" style={{ background: `hsl(${hue(r.sessionId)} 55% 45%)` }} title={r.sessionId}>
                {names.get(r.sessionId) ?? r.sessionId.slice(0, 8)}
              </span>
            )}
            <span className="feedtags">
              {[...r.tags].map((t) => (<span key={t} className="tagchip" style={{ background: `var(--tag-${t.toLowerCase()})` }}>{t}</span>))}
            </span>
            <span className="feedlabel">{r.label}</span>
            <span className={`badge ${r.status === 'error' ? 'err' : ''}`}>{r.status === 'running' ? <><span className="dot live" /> {STATUS_LABEL[r.status]}</> : STATUS_LABEL[r.status]}</span>
            {r.outputTokens > 0 && <span className="muted">{fmt(r.outputTokens)} out</span>}
            {r.narration && !compact && !open.has(`${r.sessionId}:${r.index}`) && <div className="feednarr muted">{r.narration}</div>}
            {open.has(`${r.sessionId}:${r.index}`) && <Expanded row={r} onOpen={() => onOpen(r.sessionId, r.index)} />}
          </div>
        ))}
        {!rows.length && <div className="muted">Waiting for activity… new actions appear here as soon as Claude Code logs them.</div>}
      </div>
    </div>
  );
}
