import { TAG_NAMES, type Interaction, type Prompt, type Tag } from '@agent-ato/shared';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { fmt, findRepeats } from './math';

const ROW_H = 20;
const CHART_H = 110;
const TAGS: Tag[] = ['D', 'R', 'W', 'E'];
const TAG_VAR: Record<Tag, string> = { D: 'var(--tag-d)', R: 'var(--tag-r)', W: 'var(--tag-w)', E: 'var(--tag-e)' };

interface Props {
  items: Interaction[];
  prompts: Prompt[];
  compactions: number[];
  pendingIds: Set<string>;
  active: boolean;
  follow: boolean;
  selected: number | null;
  onSelect: (i: number | null) => void;
}

interface Marks {
  prompts: Prompt[];
  compactions: number[];
  cw: number;
  height: number;
}

function Markers({ prompts, compactions, cw, height }: Marks) {
  return (
    <>
      {prompts.map((p) => (
        <line key={`p${p.index}`} x1={p.firstInteraction * cw} x2={p.firstInteraction * cw} y1={0} y2={height}
          stroke="var(--muted)" strokeOpacity={0.5} strokeWidth={1} />
      ))}
      {compactions.map((c, k) => (
        <line key={`c${k}`} x1={c * cw} x2={c * cw} y1={0} y2={height} stroke="var(--err)" strokeDasharray="3 3" />
      ))}
    </>
  );
}

interface RowProps {
  items: Interaction[];
  filter: Tag | 'all';
  cw: number;
  marks: Omit<Marks, 'height' | 'cw'>;
  hoverLabel: string | null;
  matches: Set<number>;
  selected: number | null;
  pendingIds: Set<string>;
  onHover: (i: number | null, e?: React.MouseEvent) => void;
  onClick: (i: number, shift: boolean) => void;
}

const Row = memo(function Row({ items, filter, cw, marks, hoverLabel, matches, selected, pendingIds, onHover, onClick }: RowProps) {
  const at = (e: React.MouseEvent<SVGSVGElement>): number | null => {
    const x = e.clientX - e.currentTarget.getBoundingClientRect().left;
    const i = Math.floor(x / cw);
    return i >= 0 && i < items.length ? i : null;
  };
  return (
    <svg width={Math.max(items.length * cw, 1)} height={ROW_H}
      onMouseMove={(e) => onHover(at(e), e)} onMouseLeave={() => onHover(null)}
      onClick={(e) => { const i = at(e); if (i !== null) onClick(i, e.shiftKey); }}>
      {items.map((it, i) => {
        const hit = filter === 'all' ? it.tags : it.tags.filter((t) => t === filter);
        const colors = hit.length ? hit.map((t) => TAG_VAR[t]) : ['var(--tag-none)'];
        const pending = it.tools.some((t) => t.status === 'pending' || pendingIds.has(t.id));
        const cls = ['cell',
          hoverLabel && it.label !== hoverLabel ? 'dim' : '',
          pending && i === items.length - 1 ? 'pending' : '',
          it.hasError ? 'err' : '', selected === i ? 'sel' : '', matches.has(i) ? 'match' : ''].join(' ');
        const h = (ROW_H - 4) / colors.length;
        return (
          <g key={it.index} className={cls}>
            {colors.map((c, k) => (
              <rect key={k} x={i * cw + 0.5} y={2 + k * h} width={Math.max(cw - 1, 1)} height={h} rx={1} style={{ fill: c }} />
            ))}
          </g>
        );
      })}
      <Markers {...marks} cw={cw} height={ROW_H} />
    </svg>
  );
});

export function Timeline({ items, prompts, compactions, pendingIds, active, follow, selected, onSelect }: Props) {
  const [cw, setCw] = useState(10);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const [range, setRange] = useState<[number, number] | null>(null);
  const [logScale, setLogScale] = useState(false);
  const [showCtx, setShowCtx] = useState(true);
  const [matchPos, setMatchPos] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scroller.current;
    if (el && follow) el.scrollLeft = el.scrollWidth;
  }, [items.length, follow, cw]);

  const marks = useMemo(() => ({ prompts, compactions }), [prompts, compactions]);
  const hoverLabel = hover ? (items[hover.i]?.label ?? null) : null;
  const repeats = useMemo(() => (range ? findRepeats(items, range[0], range[1]) : []), [items, range]);
  const matches = useMemo(() => {
    const s = new Set<number>();
    if (!range) return s;
    const len = Math.abs(range[1] - range[0]) + 1;
    for (const st of repeats) for (let k = 0; k < len; k++) s.add(st + k);
    return s;
  }, [repeats, range]);

  const onHover = (i: number | null, e?: React.MouseEvent): void =>
    setHover(i === null || !e ? null : { i, x: e.clientX, y: e.clientY });
  const onClick = (i: number, shift: boolean): void => {
    if (shift && selected !== null) {
      setRange([selected, i]);
      setMatchPos(0);
    } else {
      setRange(null);
      onSelect(selected === i ? null : i);
    }
  };
  const jump = (dir: 1 | -1): void => {
    if (!repeats.length) return;
    const p = (matchPos + dir + repeats.length) % repeats.length;
    setMatchPos(p);
    const target = repeats[p]!;
    scroller.current?.scrollTo({ left: Math.max(0, target * cw - 200), behavior: 'smooth' });
  };

  const width = Math.max(items.length * cw, 1);
  const scale = (v: number, max: number): number => (logScale ? Math.log1p(v) / Math.log1p(max) : v / max) * (CHART_H - 8);
  const maxTok = Math.max(1, ...items.map((i) => i.outputTokens + i.toolResultTokensEst));
  const maxCtx = Math.max(1, ...items.map((i) => i.contextTokens));
  const ctxPath = items.map((it, i) => `${i === 0 ? 'M' : 'L'}${i * cw + cw / 2},${CHART_H - 4 - (it.contextTokens / maxCtx) * (CHART_H - 8)}`).join(' ');
  const hovered = hover ? items[hover.i] : undefined;

  const rows: { key: string; label: string; filter: Tag | 'all' }[] = [
    { key: 'all', label: 'All', filter: 'all' },
    ...TAGS.map((t) => ({ key: t, label: TAG_NAMES[t], filter: t })),
  ];
  const rowProps = { items, cw, marks, hoverLabel, matches, selected, pendingIds, onHover, onClick };

  return (
    <div>
      <div className="tabs" style={{ marginBottom: 8 }}>
        <label className="muted">Zoom <input type="range" min={3} max={28} value={cw} onChange={(e) => setCw(Number(e.target.value))} /></label>
        <label><input type="checkbox" checked={logScale} onChange={(e) => setLogScale(e.target.checked)} /> log tokens</label>
        <label><input type="checkbox" checked={showCtx} onChange={(e) => setShowCtx(e.target.checked)} /> context line</label>
        {range && (
          <span className="card" style={{ padding: '2px 8px' }}>
            Pattern of {Math.abs(range[1] - range[0]) + 1} found {repeats.length}× elsewhere{' '}
            <button onClick={() => jump(-1)}>◀</button> <button onClick={() => jump(1)}>▶</button>{' '}
            <button onClick={() => setRange(null)}>clear</button>
          </span>
        )}
        <span className="muted">Shift-click a second cell to find repeated sequences</span>
        {active && <span><span className="dot live" /> live</span>}
      </div>
      <div className="tl">
        <div className="tl-labels">
          {rows.map((r) => (<div key={r.key} style={{ height: ROW_H }}>{r.label}</div>))}
          <div style={{ height: CHART_H }}>Tokens</div>
        </div>
        <div className="tl-scroll" ref={scroller}>
          {rows.map((r) => (<Row key={r.key} filter={r.filter} {...rowProps} />))}
          <svg width={width} height={CHART_H}
            onMouseMove={(e) => { const i = Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / cw); onHover(i >= 0 && i < items.length ? i : null, e); }}
            onMouseLeave={() => onHover(null)}
            onClick={(e) => { const i = Math.floor((e.clientX - e.currentTarget.getBoundingClientRect().left) / cw); if (i >= 0 && i < items.length) onClick(i, e.shiftKey); }}>
            {items.map((it, i) => {
              const think = scale(it.thinkingTokens, maxTok);
              const out = scale(it.outputTokens, maxTok);
              const tool = scale(it.outputTokens + it.toolResultTokensEst, maxTok) - out;
              const x = i * cw + 0.5;
              const w = Math.max(cw - 1, 1);
              return (
                <g key={it.index} className={hoverLabel && it.label !== hoverLabel ? 'cell dim' : 'cell'}>
                  <rect x={x} width={w} y={CHART_H - think} height={think} style={{ fill: 'var(--tok-think)' }} />
                  <rect x={x} width={w} y={CHART_H - out} height={Math.max(out - think, 0)} style={{ fill: 'var(--tok-out)' }} />
                  <rect x={x} width={w} y={CHART_H - out - Math.max(tool, 0)} height={Math.max(tool, 0)} style={{ fill: 'var(--tok-tool)' }} />
                </g>
              );
            })}
            {showCtx && <path d={ctxPath} fill="none" stroke="var(--tok-ctx)" strokeWidth={1.5} />}
            <Markers {...marks} cw={cw} height={CHART_H} />
          </svg>
        </div>
      </div>
      <div className="legend" style={{ marginTop: 6 }}>
        {TAGS.map((t) => (<span key={t}><i style={{ background: TAG_VAR[t] }} />{TAG_NAMES[t]}</span>))}
        <span><i style={{ background: 'var(--tag-none)' }} />Other</span>
        <span><i style={{ background: 'var(--tok-think)' }} />Thinking tokens</span>
        <span><i style={{ background: 'var(--tok-out)' }} />Output tokens</span>
        <span><i style={{ background: 'var(--tok-tool)' }} />≈ Tool-result tokens</span>
        <span><i style={{ background: 'var(--tok-ctx)' }} />Context size</span>
        <span className="muted">│ prompt ┆ compaction</span>
      </div>
      {hover && hovered && (
        <div className="tooltip" style={{ left: Math.min(hover.x + 12, window.innerWidth - 440), top: hover.y + 16 }}>
          #{hovered.index} {hovered.tags.join('') || '-'} · {hovered.label} · out {fmt(hovered.outputTokens)} · ≈tool {fmt(hovered.toolResultTokensEst)}
        </div>
      )}
    </div>
  );
}
