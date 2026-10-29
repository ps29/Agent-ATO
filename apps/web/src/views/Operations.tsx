import { CRUD_OPS, type CrudOp } from '@agent-ato/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, type OperationRow } from '../api';
import { CodeBox } from '../components/CodeBox';
import { RiskBadge } from '../components/RiskBadge';
import { useStore } from '../store';

const OP_LABEL: Record<CrudOp, string> = { create: 'Create', read: 'Read', update: 'Update', delete: 'Delete', run: 'Run' };
const DEFAULT_OPS: CrudOp[] = ['create', 'read', 'update', 'delete'];

const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
  const n = new Set(set);
  if (!n.delete(v)) n.add(v);
  return n;
};

/** Every file and command operation the agent performed, with its code in a highlighted box. */
export function Operations() {
  const feedSize = useStore((s) => s.feed.length);
  const selectedId = useStore((s) => s.selectedId);
  const openInTimeline = useStore((s) => s.openInTimeline);
  const [ops, setOps] = useState<Set<CrudOp>>(new Set(DEFAULT_OPS));
  const [q, setQ] = useState('');
  const [onlySession, setOnlySession] = useState(false);
  const [risk, setRisk] = useState('');
  const [rows, setRows] = useState<OperationRow[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showOutput, setShowOutput] = useState<Set<string>>(new Set());
  const seq = useRef(0);

  const params = useCallback(
    (before?: number) => ({ op: [...ops].join(','), q: q || undefined, risk: risk || undefined, session: onlySession && selectedId ? selectedId : undefined, before }),
    [ops, q, risk, onlySession, selectedId],
  );

  // Reload on filter changes, and (debounced) when new activity arrives.
  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api
        .operations(params())
        .then((r) => {
          if (mine !== seq.current) return;
          setRows(r.items);
          setNext(r.next);
          setError(false);
          setLoaded(true);
        })
        .catch(() => mine === seq.current && setError(true));
    }, 300);
    return () => clearTimeout(t);
  }, [params, feedSize]);

  const more = (): void => {
    if (next === null) return;
    void api.operations(params(next)).then((r) => {
      setRows((old) => [...old, ...r.items]);
      setNext(r.next);
    });
  };

  return (
    <div className="card">
      <div className="tabs" style={{ marginBottom: 10 }}>
        <b>Operations</b>
        {CRUD_OPS.map((o) => (
          <button key={o} className={`${ops.has(o) ? 'active' : ''} op-${o}`} aria-pressed={ops.has(o)} onClick={() => setOps(toggle(ops, o))}>
            {OP_LABEL[o]}
          </button>
        ))}
        <input type="search" placeholder="Filter by path or code" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter operations" />
        <select value={risk} onChange={(e) => setRisk(e.target.value)} aria-label="Minimum risk">
          <option value="">any risk</option>
          <option value="medium">medium and up</option>
          <option value="high">high and up</option>
          <option value="critical">critical only</option>
        </select>
        <label>
          <input type="checkbox" checked={onlySession} onChange={(e) => setOnlySession(e.target.checked)} /> selected session only
        </label>
        <span className="muted">{rows.length} shown</span>
      </div>
      {error && <div className="muted">Could not load operations.</div>}
      <div className="oplist">
        {rows.map((r, i) => {
          const id = `${r.sessionId}:${r.index}:${i}`;
          return (
            <div key={id} className={`opcard risk-card-${r.risk}`}>
              <div className="tabs">
                <span className={`opbadge op-${r.op}`}>{OP_LABEL[r.op]}</span>
                <b>{r.tool}</b>
                <RiskBadge level={r.risk} reasons={r.riskReasons} />
                <code className="optarget" title={r.target}>
                  {r.target}
                </code>
                <span className={`badge ${r.status === 'error' ? 'err' : ''}`}>{r.status}</span>
                {r.truncated && (
                  <span className="badge" title="Claude Code stored only part of this input">
                    partial
                  </span>
                )}
                <span className="spacer" />
                <span className="muted">{r.ts ? new Date(r.ts).toLocaleString() : ''}</span>
                <button onClick={() => openInTimeline(r.sessionId, r.index)}>Open in timeline</button>
              </div>
              {r.code && <CodeBox code={r.code} language={r.language} label={r.tool === 'Read' ? 'file contents' : r.language} />}
              {r.output && r.tool !== 'Read' && (
                <>
                  <button onClick={() => setShowOutput(toggle(showOutput, id))}>{showOutput.has(id) ? 'Hide result' : 'Show result'}</button>
                  {showOutput.has(id) && <CodeBox code={r.output} language="plaintext" label="result" maxHeight={200} />}
                </>
              )}
            </div>
          );
        })}
        {!rows.length && !error && <div className="muted">{loaded ? 'No matching operations yet.' : 'Loading…'}</div>}
        {next !== null && <button onClick={more}>Load older</button>}
      </div>
    </div>
  );
}
