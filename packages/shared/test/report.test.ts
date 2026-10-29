import { describe, expect, it } from 'vitest';
import { buildReport, REPORT_KINDS, type ReportInput } from '../src/report.js';
import type { Interaction, ToolCall } from '../src/types.js';

const tool = (id: string, name: string, input: object, output: string, status: ToolCall['status'] = 'ok'): ToolCall => ({
  id, name, label: name, tags: [], categories: [], input: JSON.stringify(input), output, status,
});

const item = (index: number, startMs: number, tools: ToolCall[], extra: Partial<Interaction> = {}): Interaction => ({
  id: `r${index}`, sessionId: 's', index, label: 'x', tags: [], categories: [], promptIndex: 0, model: 'm', outputTokens: 1,
  thinkingTokens: 0, toolResultTokensEst: 0, contextTokens: 0, startMs, endMs: startMs + 1000, thinkingMs: null, effort: null,
  narration: '', thinking: '', isSidechain: false, hasError: tools.some((t) => t.status === 'error'), tools, ...extra,
});

const T0 = Date.UTC(2026, 0, 2, 3, 4, 5);

const input = (kind: ReportInput['kind']): ReportInput => ({
  kind,
  generatedMs: T0 + 60_000,
  session: { id: 'sess-1', title: 'Fix login', project: 'proj', cwd: '/w', gitBranch: 'main', models: ['m'], startMs: T0, endMs: T0 + 120_000, nInteractions: 3, nErrors: 1, outTokens: 9 },
  prompts: [{ index: 0, firstInteraction: 0, ts: T0, text: 'Login fails with a 500 error' }],
  items: [
    item(0, T0, [tool('a', 'Bash', { command: 'npm test' }, 'FAIL 1 test', 'error')], { narration: 'Tests fail, checking the handler.' }),
    item(1, T0 + 30_000, [tool('b', 'Edit', { file_path: 'src/login.ts', old_string: 'a', new_string: 'b' }, 'updated')]),
    item(2, T0 + 60_000, [
      tool('c', 'Write', { file_path: 'docs/note.md', content: 'x' }, 'File created successfully'),
      tool('d', 'Bash', { command: 'rm -rf build' }, ''),
    ]),
  ],
  guard: [{ ts: T0 + 61_000, tool: 'Bash', target: 'git push', decision: 'ask', reason: 'High risk' }],
});

describe('buildReport', () => {
  it.each(REPORT_KINDS.map((k) => k.id))('%s renders facts and leaves judgement to a human', (kind) => {
    const md = buildReport(input(kind));
    expect(md).toContain('Fix login');
    expect(md).toContain('2026-01-02 03:04:05');
    expect(md).toContain('**TODO (human):**');
    expect(md).toContain('src/login.ts');
  });

  it('is deterministic', () => {
    expect(buildReport(input('pir'))).toBe(buildReport(input('pir')));
  });

  it('puts changes under Added, Changed and Removed in the change log', () => {
    const md = buildReport(input('changelog'));
    expect(md).toMatch(/### Added\n- `docs\/note.md`/);
    expect(md).toMatch(/### Changed\n- `src\/login.ts`/);
    expect(md).toMatch(/### Removed\n- `\(shell\)|### Removed\n- `rm -rf build`/);
  });

  it('shows failures, risky actions and guard decisions in the timeline', () => {
    const md = buildReport(input('pir'));
    expect(md).toContain('FAIL 1 test');
    expect(md).toContain('high-risk action');
    expect(md).toContain('Guard ask');
  });

  it('does not invent a root cause', () => {
    const md = buildReport(input('rca'));
    expect(md).toMatch(/## Causal analysis\n> \*\*TODO \(human\)/);
  });

  it('keeps code with backticks inside its fence', () => {
    const i = input('rca');
    i.items[0]!.tools[0]!.output = 'bad ``` fence';
    const md = buildReport(i);
    expect(md).toContain('````\nbad ``` fence\n````');
  });

  it('escapes table pipes in cells', () => {
    const i = input('pir');
    i.items[0]!.tools[0]!.output = 'a | b';
    expect(buildReport(i)).toContain('a \\| b');
  });
});
