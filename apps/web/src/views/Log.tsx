import { useEffect, useState } from 'react';
import { api, type LogRow } from '../api';
import { useStore } from '../store';

export function Log() {
  const [tag, setTag] = useState('');
  const [errors, setErrors] = useState(false);
  const [rows, setRows] = useState<LogRow[]>([]);
  const selectedId = useStore((s) => s.selectedId);
  const [onlyThis, setOnlyThis] = useState(false);
  const sessions = useStore((s) => s.sessions);
  const select = useStore((s) => s.select);
  const setView = useStore((s) => s.setView);
  const setFollow = useStore((s) => s.setFollow);

  useEffect(() => {
    api.log({ tag: tag || undefined, errors, session: onlyThis ? (selectedId ?? undefined) : undefined }).then(setRows).catch(() => setRows([]));
  }, [tag, errors, onlyThis, selectedId]);

  const title = (id: string): string => sessions.find((s) => s.id === id)?.title ?? id.slice(0, 8);
  return (
    <div className="card">
      <div className="tabs" style={{ marginBottom: 8 }}>
        <b>Event log</b>
        <select value={tag} onChange={(e) => setTag(e.target.value)} aria-label="Tag filter">
          <option value="">all tags</option><option value="D">Discovery</option><option value="R">Reading</option>
          <option value="W">Writing</option><option value="E">Execution</option>
        </select>
        <label><input type="checkbox" checked={errors} onChange={(e) => setErrors(e.target.checked)} /> errors only</label>
        <label><input type="checkbox" checked={onlyThis} onChange={(e) => setOnlyThis(e.target.checked)} /> selected session only</label>
        <span className="muted">newest {rows.length}</span>
      </div>
      <table>
        <thead><tr><th>Time</th><th>Session</th><th>Tags</th><th>Action</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.session_id}:${r.idx}`} className="click" onClick={() => { setFollow(false); setView('live'); void select(r.session_id, r.idx); }}>
              <td>{r.start_ms ? new Date(r.start_ms).toLocaleString() : ''}</td>
              <td>{title(r.session_id)}</td>
              <td>{[...r.tags].map((t) => (<span key={t} className="tagchip" style={{ background: `var(--tag-${t.toLowerCase()})` }}>{t}</span>))}</td>
              <td>{r.has_error ? <span className="badge err">error</span> : null} {r.label}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
