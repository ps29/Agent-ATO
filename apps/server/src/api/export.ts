import type { SessionSnapshot } from '../store/repo.js';

const csvCell = (v: unknown): string => {
  const s = String(v ?? '');
  // Neutralise spreadsheet formula injection as well as quoting.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(snap: SessionSnapshot): string {
  const head = ['index', 'time', 'tags', 'label', 'output_tokens', 'thinking_tokens', 'tool_result_tokens_est', 'context_tokens', 'error'];
  const rows = snap.items.map((i) => [
    i.index, i.startMs ? new Date(i.startMs).toISOString() : '', i.tags.join(''), i.label,
    i.outputTokens, i.thinkingTokens, i.toolResultTokensEst, i.contextTokens, i.hasError ? 1 : 0,
  ]);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}

export function toMarkdown(snap: SessionSnapshot): string {
  const out = [`# ${snap.session.title ?? snap.session.id}`, '', `Project: ${snap.session.project}`, ''];
  for (const i of snap.items) {
    out.push(`## ${i.index}. [${i.tags.join('') || '-'}] ${i.label}${i.hasError ? ' (error)' : ''}`);
    if (i.narration.trim()) out.push('', i.narration.trim());
    for (const t of i.tools) out.push('', `- \`${t.name}\` ${t.status}: ${t.label}`);
    out.push('');
  }
  return out.join('\n');
}
