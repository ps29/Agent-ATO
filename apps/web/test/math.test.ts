import type { Interaction, Prompt } from '@agent-ato/shared';
import { describe, expect, it } from 'vitest';
import { contextGrowth, findRepeats, fmt, mergeItems } from '../src/timeline/math';

const it_ = (label: string, o: Partial<Interaction> = {}): Interaction =>
  ({ label, index: 0, outputTokens: 0, toolResultTokensEst: 0, contextTokens: 0, tools: [], tags: [], ...o }) as Interaction;

describe('timeline math', () => {
  it('finds repeated label sequences', () => {
    const items = ['a', 'b', 'c', 'a', 'b', 'x', 'a', 'b'].map((l) => it_(l));
    expect(findRepeats(items, 0, 1)).toEqual([3, 6]);
    expect(findRepeats(items, 1, 0)).toEqual([3, 6]);
    expect(findRepeats(items, 5, 5)).toEqual([]);
  });

  it('attributes context growth with estimates', () => {
    const items = [
      it_('a', { contextTokens: 1000, outputTokens: 100, toolResultTokensEst: 300 }),
      it_('b', { contextTokens: 1600 }),
    ];
    const prompts = [{ index: 0, firstInteraction: 1, ts: null, text: 'x'.repeat(40) }] as Prompt[];
    expect(contextGrowth(items, 1, prompts)).toEqual({ delta: 600, toolResults: 300, assistantOutput: 100, userText: 10, other: 190 });
    expect(contextGrowth(items, 0, prompts)).toBeNull();
  });

  it('merges by index and formats numbers', () => {
    const merged = mergeItems([it_('a', { index: 0 })], [it_('b', { index: 1 }), it_('c', { index: 0 })]);
    expect(merged.map((i) => i.label)).toEqual(['c', 'b']);
    expect(fmt(1500)).toBe('1.5k');
    expect(fmt(2_500_000)).toBe('2.5M');
  });
});
