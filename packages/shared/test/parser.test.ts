import { describe, expect, it } from 'vitest';
import { TranscriptParser } from '../src/index.js';

const usage = { input_tokens: 2, cache_read_input_tokens: 100, cache_creation_input_tokens: 10, output_tokens: 50, output_tokens_details: { thinking_tokens: 20 } };
const rec = (o: object): string => JSON.stringify(o);

const lines = [
  rec({ type: 'ai-title', aiTitle: 'Demo' }),
  rec({ type: 'user', timestamp: '2026-01-01T00:00:00Z', message: { content: 'hello' }, cwd: '/p' }),
  rec({ type: 'assistant', requestId: 'r1', timestamp: '2026-01-01T00:00:01Z', thinkingDurationMs: 900, message: { model: 'm', usage, content: [{ type: 'thinking', thinking: '' }] } }),
  rec({ type: 'assistant', requestId: 'r1', timestamp: '2026-01-01T00:00:02Z', message: { model: 'm', usage, content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test' } }] } }),
  rec({ type: 'user', timestamp: '2026-01-01T00:00:03Z', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'x'.repeat(40), is_error: true }] } }),
  rec({ type: 'assistant', requestId: 'r2', timestamp: '2026-01-01T00:00:04Z', message: { model: 'm', usage: { ...usage, output_tokens: 7 }, content: [{ type: 'text', text: 'done' }] } }),
];
const text = `${lines.join('\n')}\n`;

describe('TranscriptParser', () => {
  it('groups records by requestId and counts usage once', () => {
    const p = new TranscriptParser('s');
    p.feed(text);
    expect(p.items).toHaveLength(2);
    expect(p.items[0]).toMatchObject({ outputTokens: 50, thinkingTokens: 20, contextTokens: 112, thinkingMs: 900, tags: ['E'], hasError: true, toolResultTokensEst: 10 });
    expect(p.items[0]!.tools[0]).toMatchObject({ status: 'error', label: 'npm test' });
    expect(p.items[1]).toMatchObject({ label: '(reply)', promptIndex: 0 });
    expect(p.meta).toMatchObject({ title: 'Demo', cwd: '/p' });
    expect(p.prompts).toHaveLength(1);
  });

  it('gives identical results when fed in arbitrary chunks', () => {
    const whole = new TranscriptParser('s');
    whole.feed(text);
    for (const size of [1, 7, 33, 200]) {
      const p = new TranscriptParser('s');
      for (let i = 0; i < text.length; i += size) p.feed(text.slice(i, i + size));
      expect(p.items).toEqual(whole.items);
      expect(p.meta).toEqual(whole.meta);
    }
  });

  it('ignores malformed lines and holds back partial ones', () => {
    const p = new TranscriptParser('s');
    expect(p.feed('not json\n{"type":"ai-title"')).toEqual([]);
    p.feed(',"aiTitle":"T"}\n');
    expect(p.meta.title).toBe('T');
  });
});
