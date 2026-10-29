import { assessRisk, riskAtLeast, toOperation, type Risk } from '@agent-ato/shared';
import { useMemo, useState } from 'react';
import { CodeBox } from '../components/CodeBox';
import { RiskBadge } from '../components/RiskBadge';
import { useStore } from '../store';
import { fmt } from '../timeline/math';

type Floor = 'all' | 'medium' | 'high';

/**
 * What the agent said and how long it thought before each action, with the action's risk beside it.
 * Claude Code does not store the model's private thinking text, so this shows the visible commentary
 * between tool calls plus the size and duration of the hidden thinking.
 */
export function Reasoning() {
  const items = useStore((s) => s.items);
  const prompts = useStore((s) => s.prompts);
  const meta = useStore((s) => s.meta);
  const openInTimeline = useStore((s) => s.openInTimeline);
  const selectedId = useStore((s) => s.selectedId);
  const [floor, setFloor] = useState<Floor>('all');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [q, setQ] = useState('');
  const [newestFirst, setNewestFirst] = useState(true);

  const rows = useMemo(() => {
    const min: Risk | null = floor === 'all' ? null : floor;
    const text = q.trim().toLowerCase();
    const list = items
      .map((it) => ({ it, assessed: it.tools.map((t) => ({ t, risk: assessRisk(t) })) }))
      .filter(({ it, assessed }) => {
        if (errorsOnly && !it.hasError) return false;
        if (min && !assessed.some((a) => riskAtLeast(a.risk.level, min))) return false;
        if (text && !`${it.narration} ${it.label}`.toLowerCase().includes(text)) return false;
        return Boolean(it.narration.trim() || it.thinkingTokens || assessed.length);
      });
    return newestFirst ? [...list].reverse() : list;
  }, [items, floor, errorsOnly, q, newestFirst]);

  const promptAt = (idx: number): string | undefined => prompts.find((p) => p.firstInteraction === idx)?.text;

  return (
    <div className="card">
      <div className="tabs" style={{ marginBottom: 8 }}>
        <b>Reasoning</b>
        <span className="muted">{meta?.title ?? selectedId ?? 'no session selected'}</span>
        <span className="spacer" />
        <select value={floor} onChange={(e) => setFloor(e.target.value as Floor)} aria-label="Minimum risk">
          <option value="all">all actions</option>
          <option value="medium">medium risk and up</option>
          <option value="high">high risk and up</option>
        </select>
        <label>
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} /> errors only
        </label>
        <input type="search" placeholder="Search commentary" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search commentary" />
        <button onClick={() => setNewestFirst(!newestFirst)}>{newestFirst ? 'Newest first' : 'Oldest first'}</button>
      </div>
      <div className="notice">
        Claude Code stores the <b>size and duration</b> of the model’s hidden thinking, not its text. What you can read here is the agent’s own
        commentary written between tool calls, which is the closest record of its reasoning.
      </div>
      <div className="oplist">
        {rows.map(({ it, assessed }) => {
          const top = assessed.reduce<Risk>((m, a) => (riskAtLeast(a.risk.level, m) ? a.risk.level : m), 'low');
          const ask = promptAt(it.index);
          return (
            <div key={it.index}>
              {ask && <div className="promptline"><span className="muted">User asked</span> {ask.length > 300 ? `${ask.slice(0, 300)}…` : ask}</div>}
              <div className={`opcard risk-card-${top} ${it.hasError ? 'has-error' : ''}`}>
                <div className="tabs">
                  <b>Step {it.index}</b>
                  <span className="muted">{it.startMs ? new Date(it.startMs).toLocaleTimeString() : ''}</span>
                  {it.model && <span className="badge">{it.model}</span>}
                  {it.effort && <span className="badge">effort: {it.effort}</span>}
                  {it.thinkingTokens > 0 && (
                    <span className="badge" title="Size of hidden thinking; the text is not stored">
                      thought {fmt(it.thinkingTokens)} tokens{it.thinkingMs ? ` · ${Math.round(it.thinkingMs / 1000)}s` : ''}
                    </span>
                  )}
                  <RiskBadge level={top} />
                  {it.hasError && <span className="badge err">error</span>}
                  <span className="spacer" />
                  <button onClick={() => openInTimeline(it.sessionId, it.index)}>Open in timeline</button>
                </div>
                {it.narration.trim() ? <div className="narration">{it.narration.trim()}</div> : <div className="muted">No commentary, action only.</div>}
                {assessed.map(({ t, risk }) => {
                  const op = toOperation(t);
                  const loud = riskAtLeast(risk.level, 'medium');
                  return (
                    <div key={t.id} className="reasonact">
                      <div className="tabs">
                        <b>{t.name}</b>
                        <code className="optarget" title={t.label}>{op?.target || t.label}</code>
                        <RiskBadge level={risk.level} reasons={risk.reasons} />
                        <span className={`badge ${t.status === 'error' ? 'err' : ''}`}>{t.status}</span>
                      </div>
                      {loud && risk.reasons.length > 0 && <div className="riskwhy">{risk.reasons.join('; ')}</div>}
                      {loud && op?.code && <CodeBox code={op.code} language={op.language} label="risky action" maxHeight={160} />}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!rows.length && <div className="muted">Nothing matches. Select a session in the sidebar or relax the filters.</div>}
      </div>
    </div>
  );
}
