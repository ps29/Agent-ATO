import type { Risk } from '@agent-ato/shared';

interface Props {
  level: Risk;
  reasons?: string[];
  /** Low risk is the normal case, so it is hidden unless asked for. */
  showLow?: boolean;
}

/** Coloured risk label. The reasons show on hover and are also exposed to screen readers. */
export function RiskBadge({ level, reasons = [], showLow }: Props) {
  if (level === 'low' && !showLow) return null;
  const why = reasons.join('; ');
  return (
    <span className={`riskbadge risk-${level}`} title={why || `${level} risk`}>
      {level === 'critical' || level === 'high' ? '⚠ ' : ''}
      {level} risk
      {why && <span className="sr-only">: {why}</span>}
    </span>
  );
}
