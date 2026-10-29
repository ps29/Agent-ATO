import { describe, expect, it } from 'vitest';
import { DEFAULTS, normalizeDesign } from '../src/settings';

describe('design setting', () => {
  it('defaults to the original design', () => {
    expect(DEFAULTS.design).toBe('original');
  });

  it('only accepts "updated" as an opt-in and falls back otherwise', () => {
    expect(normalizeDesign('updated')).toBe('updated');
    expect(normalizeDesign('original')).toBe('original');
    expect(normalizeDesign('glass')).toBe('original');
    expect(normalizeDesign(undefined)).toBe('original');
    expect(normalizeDesign(42)).toBe('original');
  });
});
