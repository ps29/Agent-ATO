import type { Interaction, Prompt } from '@agent-ato/shared';
import { TAG_NAMES } from '@agent-ato/shared';
import type { HookRow } from '../api';
import { contextGrowth, fmt, fmtDuration } from '../timeline/math';

interface Props {
  items: Interaction[];
  index: number;
  prompts: Prompt[];
  hooks: HookRow[];
  onClose: () => void;
  onStep: (d: 1 | -1) => void;
}

export function Detail({ items, index, prompts, hooks, onClose, onStep }: Props) {
  const it = items[index];
  if (!it) return null;
  const prompt = prompts[it.promptIndex];
  const growth = contextGrowth(items, index, prompts);
  const toolIds = new Set(it.tools.map((t) => t.id));
  const hookRows = hooks.filter((h) => h.toolUseId && toolIds.has(h.toolUseId)).sort((a, b) => a.ts - b.ts);

  return (
    <aside className="detail" aria-label="Interaction detail">
      <div className="tabs">
        <b>#{it.index} · {it.label}</b>
        <span className="spacer" />
        <button onClick={() => onStep(-1)} aria-label="Previous">◀</button>
        <button onClick={() => onStep(1)} aria-label="Next">▶</button>
        <button onClick={onClose} aria-label="Close">✕</button>
      </div>
      <div className="muted">
        {it.tags.map((t) => TAG_NAMES[t]).join(' + ') || 'Untagged'}
        {it.categories.length ? ` · ${it.categories.join(', ')}` : ''}
        {it.isSidechain ? ' · sub-agent' : ''}
        {it.startMs ? ` · ${new Date(it.startMs).toLocaleTimeString()}` : ''}
        {it.startMs && it.endMs ? ` · ${fmtDuration(it.endMs - it.startMs)}` : ''}
      </div>

      {prompt && (
        <div className="card">
          <div className="muted">Prompt #{prompt.index + 1}</div>
          <pre>{prompt.text}</pre>
        </div>
      )}

      <div className="card">
        <b>Reasoning</b>
        <div className="muted">
          {fmt(it.thinkingTokens)} thinking tokens
          {it.thinkingMs ? ` · ${fmtDuration(it.thinkingMs)}` : ''}
          {it.effort ? ` · effort ${it.effort}` : ''}
          {it.model ? ` · ${it.model}` : ''}
        </div>
        {it.thinking.trim() ? (
          <pre>{it.thinking}</pre>
        ) : it.thinkingTokens > 0 ? (
          <div className="muted">Claude Code did not store the thinking text for this response; only its size is recorded.</div>
        ) : null}
        {it.narration.trim() && (<><div className="muted" style={{ marginTop: 6 }}>Visible narration</div><pre>{it.narration}</pre></>)}
      </div>

      <div className="card">
        <b>Tokens</b>
        <div className="muted">
          output {fmt(it.outputTokens)} · ≈ tool results {fmt(it.toolResultTokensEst)} · context {fmt(it.contextTokens)}
        </div>
        {growth && (
          <div className="muted">
            Context change {growth.delta >= 0 ? '+' : ''}{fmt(growth.delta)} since previous: ≈ tool results {fmt(growth.toolResults)},
            ≈ assistant output {fmt(growth.assistantOutput)}, ≈ user text {fmt(growth.userText)}, other {fmt(growth.other)}
            {growth.delta < -1000 ? ' (context shrank: likely compaction)' : ''}
          </div>
        )}
      </div>

      {it.tools.map((t) => (
        <div key={t.id} className={`tool ${t.status === 'error' ? 'error' : ''}`}>
          <div className="tabs">
            <b>{t.name}</b>
            <span className={`badge ${t.status === 'error' ? 'err' : ''}`}>{t.status}</span>
            {t.tags.map((g) => (<span key={g} className="tagchip" style={{ background: `var(--tag-${g.toLowerCase()})` }}>{g}</span>))}
          </div>
          <div className="muted">Input</div>
          <pre>{t.input}</pre>
          <div className="muted">Output</div>
          <pre>{t.output || (t.status === 'pending' ? 'waiting for result…' : '(empty)')}</pre>
        </div>
      ))}

      {hookRows.length > 0 && (
        <div className="card">
          <b>Hook events</b>
          {hookRows.map((h) => (<div key={h.id} className="muted">{new Date(h.ts).toLocaleTimeString()} · {h.event}</div>))}
        </div>
      )}
    </aside>
  );
}
