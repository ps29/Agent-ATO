import { describe, expect, it } from 'vitest';
import { classifyShell, classifyTool } from '../src/index.js';

const tags = (cmd: string): string =>
  [...classifyShell(cmd).tags].sort().join('');

describe('classifyShell', () => {
  it.each([
    ['ls -la', 'D'],
    ['Get-ChildItem C:\\x | Select-Object Name', 'D'],
    ['cat foo.txt', 'R'],
    ['rg foo src', 'R'],
    ['rg -l foo src', 'D'],
    ['git diff HEAD', 'R'],
    ['git status', 'D'],
    ['git commit -m "x"', 'W'],
    ['rm -rf dist', 'W'],
    ['echo hi > out.txt', 'W'],
    ['echo hi > /dev/null', ''],
    ['sed -i s/a/b/ f', 'W'],
    ['sed -n 1,5p f', 'R'],
    ['npm test | tail -20', 'E'],
    ['python -m pytest -q', 'E'],
    ['cd /tmp && ls', 'D'],
    ["cat <<'EOF' > f.txt\nrm -rf /\nEOF", 'RW'],
    ['grep foo f | head', 'R'],
    ['echo "a > b"', ''],
  ])('%s -> %s', (cmd, expected) => {
    expect(tags(cmd)).toBe(expected);
  });

  it('labels pipelines and subcommands', () => {
    expect(classifyShell('npm run build').label).toBe('npm run build');
    expect(classifyShell('rg foo | head').label).toBe('rg | head');
    expect(classifyShell('python -m pytest').label).toBe('python -m pytest');
  });
});

describe('classifyTool', () => {
  it('maps built-in tools', () => {
    expect(classifyTool('Read', { file_path: 'C:\\a\\b.ts' })).toMatchObject({ tags: ['R'], label: 'Read b.ts' });
    expect(classifyTool('Edit', { file_path: '/a/b.ts' }).tags).toEqual(['W']);
    expect(classifyTool('Grep', {}).tags).toEqual(['D']);
    expect(classifyTool('Grep', { output_mode: 'content' }).tags).toEqual(['R']);
    expect(classifyTool('Agent', { subagent_type: 'Explore' })).toMatchObject({ tags: ['D'], categories: ['delegation'] });
  });

  it('maps MCP tools by verb', () => {
    expect(classifyTool('mcp__claude_ai_Gmail__search_threads', {})).toMatchObject({
      tags: ['D'],
      label: 'Gmail:search_threads',
      categories: ['mcp'],
    });
    expect(classifyTool('mcp__x__create_event', {}).tags).toEqual(['W']);
    expect(classifyTool('SomethingNew', {}).tags).toEqual([]);
  });
});
