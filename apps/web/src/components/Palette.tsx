import { useEffect, useRef, useState } from 'react';
import { api, type SearchHit } from '../api';
import { useStore } from '../store';

export function Palette() {
  const open = useStore((s) => s.paletteOpen);
  const setPalette = useStore((s) => s.setPalette);
  const select = useStore((s) => s.select);
  const setFollow = useStore((s) => s.setFollow);
  const setView = useStore((s) => s.setView);
  const sessions = useStore((s) => s.sessions);
  const [text, setText] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(!useStore.getState().paletteOpen); }
      if (e.key === 'Escape') setPalette(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setPalette]);

  useEffect(() => { if (open) input.current?.focus(); }, [open]);
  useEffect(() => {
    if (text.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => { api.search(text).then(setHits).catch(() => setHits([])); }, 200);
    return () => clearTimeout(t);
  }, [text]);

  if (!open) return null;
  const title = (id: string): string => sessions.find((s) => s.id === id)?.title ?? id.slice(0, 8);
  const go = (id: string, idx: number): void => { setFollow(false); setView('live'); void select(id, idx); setPalette(false); };

  return (
    <div className="palette-backdrop" onClick={() => setPalette(false)}>
      <div className="palette" role="dialog" aria-label="Search" onClick={(e) => e.stopPropagation()}>
        <input ref={input} type="search" placeholder="Search every session (commands, files, narration)…" value={text} onChange={(e) => setText(e.target.value)} />
        {hits.map((h) => (
          <div key={`${h.sessionId}:${h.idx}`} className="session" onClick={() => go(h.sessionId, h.idx)}>
            <div className="t">{title(h.sessionId)} · #{h.idx}</div>
            <div className="m">{h.snippet}</div>
          </div>
        ))}
        {text.length >= 2 && !hits.length && <div className="muted">No matches.</div>}
      </div>
    </div>
  );
}
