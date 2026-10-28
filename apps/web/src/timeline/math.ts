import type { Interaction, Prompt } from '@agent-ato/shared';

export const fmt = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));

export const fmtDuration = (ms: number): string => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};

/** Start indices where the label sequence labels[from..to] repeats (excluding the selection itself). */
export function findRepeats(items: Pick<Interaction, 'label'>[], from: number, to: number): number[] {
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const len = hi - lo + 1;
  const out: number[] = [];
  for (let s = 0; s + len <= items.length; s++) {
    if (s === lo) continue;
    let ok = true;
    for (let k = 0; k < len && ok; k++) ok = items[s + k]!.label === items[lo + k]!.label;
    if (ok) out.push(s);
  }
  return out;
}

export interface ContextGrowth {
  delta: number;
  toolResults: number;
  assistantOutput: number;
  userText: number;
  other: number;
}

/**
 * Rough attribution of how the context grew since the previous interaction. Transcripts hold no
 * per-source counts, so every figure except `delta` is an estimate.
 */
export function contextGrowth(items: Interaction[], i: number, prompts: Prompt[]): ContextGrowth | null {
  const cur = items[i];
  const prev = items[i - 1];
  if (!cur || !prev) return null;
  const delta = cur.contextTokens - prev.contextTokens;
  const toolResults = prev.toolResultTokensEst;
  const assistantOutput = prev.outputTokens;
  const newPrompt = prompts.find((p) => p.firstInteraction === i);
  const userText = newPrompt ? Math.ceil(newPrompt.text.length / 4) : 0;
  return { delta, toolResults, assistantOutput, userText, other: delta - toolResults - assistantOutput - userText };
}

/** Merge changed interactions into a list by index, keeping order. */
export function mergeItems(list: Interaction[], changed: Interaction[]): Interaction[] {
  if (!changed.length) return list;
  const next = list.slice();
  for (const it of changed) next[it.index] = it;
  return next;
}
