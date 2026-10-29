import type { Risk } from '@agent-ato/shared';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api, type AuditRow, type VerifyResult } from '../api';
import { CodeBox } from '../components/CodeBox';
import { RiskBadge } from '../components/RiskBadge';
import { useStore } from '../store';

const KINDS = ['', 'call', 'result', 'guard', 'control'] as const;

interface Detail {
  code?: string;
  language?: string;
  reasons?: string[];
  status?: string;
  output?: string;
  decision?: string;
  wouldHave?: string;
  reason?: string;
  matched?: string;
  mode?: string;
}

function parse(d: string | null): Detail {
  try {
    return d ? (JSON.parse(d) as Detail) : {};
  } catch {
    return {};
  }
}

/** The permanent, tamper-evident record of what the agent did and what Guard decided. */
export function Audit() {
  const feedSize = useStore((s) => s.feed.length);
  const selectedId = useStore((s) => s.selectedId);
  const [kind, setKind] = useState('');
  const [risk, setRisk] = useState('');
  const [q, setQ] = useState('');
  const [onlySession, setOnlySession] = useState(false);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [head, setHead] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [check, setCheck] = useState<VerifyResult | 'running' | null>(null);
  const [error, setError] = useState(false);
  const seq = useRef(0);

  const filters = useCallback(
    (before?: number) => ({ kind: kind || undefined, risk: risk || undefined, q: q || undefined, session: onlySession && selectedId ? selectedId : undefined, before }),
    [kind, risk, q, onlySession, selectedId],
  );

  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(() => {
      api.audit(filters()).then((r) => {
        if (mine !== seq.current) return;
        setRows(r.rows);
        setTotal(r.total);
        setHead(r.head);
        setError(false);
      }).catch(() => mine === seq.current && setError(true));
    }, 300);
    return () => clearTimeout(t);
  }, [filters, feedSize]);

  const older = (): void => {
    const last = rows[rows.length - 1];
    if (!last) return;
    void api.audit(filters(last.id)).then((r) => setRows((old) => [...old, ...r.rows]));
  };

  const verify = (): void => {
    setCheck('running');
    void api.auditVerify().then(setCheck, () => setCheck(null));
  };

  return (
    <div className="card">
      <div className="tabs" style={{ marginBottom: 8 }}>
        <b>Audit log</b>
        <span className="muted">{total.toLocaleString()} entries</span>
        <span className="spacer" />
        <button onClick={verify}>Verify chain</button>
        <a href="/api/audit/export?format=csv"><button>CSV</button></a>
        <a href="/api/audit/export?format=json"><button>JSON</button></a>
      </div>
      {check === 'running' && <div className="notice">Checking every entry…</div>}
      {check && check !== 'running' && (
        <div className={`notice ${check.ok ? 'good' : 'bad'}`} role="status">
          {check.ok
            ? `Chain intact: ${check.checked.toLocaleString()} entries verified.`
            : check.brokenAt
              ? `Chain broken at entry #${check.brokenAt}. That entry, or one before it, was changed after it was written.`
              : 'Chain broken: entries are missing from the end of the log.'}
        </div>
      )}
      <div className="muted headline">
        Head hash <code title={head}>{head.slice(0, 16)}…</code>. Write it down or store it elsewhere: anyone who can rewrite this whole database could
        rebuild the chain, but they cannot reproduce a head hash you already recorded.
      </div>
      <div className="tabs" style={{ margin: '8px 0' }}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Entry kind">
          {KINDS.map((k) => <option key={k} value={k}>{k || 'all kinds'}</option>)}
        </select>
        <select value={risk} onChange={(e) => setRisk(e.target.value)} aria-label="Minimum risk">
          <option value="">any risk</option><option value="medium">medium and up</option><option value="high">high and up</option><option value="critical">critical only</option>
        </select>
        <input type="search" placeholder="Search target, code or tool" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search audit log" />
        <label><input type="checkbox" checked={onlySession} onChange={(e) => setOnlySession(e.target.checked)} /> selected session only</label>
      </div>
      {error && <div className="muted">Could not load the audit log.</div>}
      <table>
        <thead><tr><th>#</th><th>Time</th><th>Kind</th><th>Risk</th><th>Tool</th><th>Op</th><th>Target</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const d = parse(r.detail);
            const isOpen = open === r.id;
            return (
              <Fragment key={r.id}>
                <tr className="click" onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen}>
                  <td>{r.id}</td>
                  <td>{new Date(r.ts).toLocaleString()}</td>
                  <td><span className={`badge kind-${r.kind}`}>{r.kind}</span></td>
                  <td><RiskBadge level={(r.risk ?? 'low') as Risk} showLow reasons={d.reasons} /></td>
                  <td>{r.tool}</td>
                  <td>{r.op}</td>
                  <td className="clip" title={r.target ?? ''}>{r.target}</td>
                </tr>
                {isOpen && (
                  <tr>
                    <td colSpan={7}>
                      <div className="oplist">
                        {d.decision && (
                          <div>
                            Guard {d.wouldHave ? `would have ${d.wouldHave === 'deny' ? 'denied' : 'asked about'} this (monitor mode)` : d.decision === 'deny' ? 'denied this' : 'asked for confirmation'}
                            {d.reason ? `: ${d.reason}` : ''} {d.matched ? <span className="badge">{d.matched}</span> : null}
                          </div>
                        )}
                        {d.reasons?.length ? <div className="riskwhy">{d.reasons.join('; ')}</div> : null}
                        {d.code && <CodeBox code={d.code} language={d.language ?? 'plaintext'} maxHeight={200} />}
                        {d.status && <div>Result: <span className={`badge ${d.status === 'error' ? 'err' : ''}`}>{d.status}</span></div>}
                        {d.output && <CodeBox code={d.output} language="plaintext" label="result (first 500 characters)" maxHeight={160} />}
                        <div className="muted">session <code>{r.session_id ?? '—'}</code> · tool call <code>{r.tool_use_id ?? '—'}</code></div>
                        <div className="muted">hash <code>{r.hash}</code></div>
                        <div className="muted">previous <code>{r.prev_hash}</code></div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      {!rows.length && !error && <div className="muted">No entries match.</div>}
      {rows.length >= 100 && rows.length < total && <button onClick={older} style={{ marginTop: 8 }}>Load older</button>}
    </div>
  );
}
