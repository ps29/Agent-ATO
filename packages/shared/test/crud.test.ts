import { describe, expect, it } from 'vitest';
import { shellOp, toOperation } from '../src/crud.js';

const tool = (name: string, input: object | string, output = '') => ({
  name,
  input: typeof input === 'string' ? input : JSON.stringify(input, null, 1),
  output,
});

describe('shellOp', () => {
  it.each([
    ['rm -rf dist', 'delete'],
    ['Remove-Item -Recurse build', 'delete'],
    ['git rm old.txt', 'delete'],
    ['mkdir -p a/b', 'create'],
    ['echo hi > out.txt', 'create'],
    ['echo hi >> out.txt', 'update'],
    ['sed -i s/a/b/ f.txt', 'update'],
    ['git commit -m x', 'update'],
    ['cat file.txt', 'read'],
    ['ls -la', 'read'],
    ['npm test', 'run'],
    ['node build.js 2>&1', 'run'],
  ])('%s -> %s', (cmd, op) => expect(shellOp(cmd)).toBe(op));
});

describe('toOperation', () => {
  it('tells a new file from an overwritten one by the result text', () => {
    const create = toOperation(tool('Write', { file_path: 'a.ts', content: 'x' }, 'File created successfully'));
    const update = toOperation(tool('Write', { file_path: 'a.ts', content: 'x' }, 'The file a.ts has been updated successfully'));
    expect(create).toMatchObject({ op: 'create', language: 'typescript', code: 'x' });
    expect(update?.op).toBe('update');
  });

  it('renders Edit as a diff', () => {
    const o = toOperation(tool('Edit', { file_path: 'a.md', old_string: 'one\ntwo', new_string: 'three' }));
    expect(o).toMatchObject({ op: 'update', language: 'diff', code: '- one\n- two\n+ three' });
  });

  it('strips line numbers from Read output', () => {
    const o = toOperation(tool('Read', { file_path: 'a.py' }, '1\tprint(1)\n2\tprint(2)'));
    expect(o).toMatchObject({ op: 'read', language: 'python', code: 'print(1)\nprint(2)' });
  });

  it('recovers fields from input cut off mid-string', () => {
    const cut = '{\n "file_path": "C:\\\\x\\\\a.js",\n "content": "line1\\nline2 and then it was trunc';
    const o = toOperation(tool('Write', cut, 'File created'));
    expect(o).toMatchObject({ op: 'create', truncated: true, target: 'C:\\x\\a.js' });
    expect(o?.code.startsWith('line1\nline2')).toBe(true);
  });

  it('maps shell commands and ignores tools with nothing to show', () => {
    expect(toOperation(tool('PowerShell', { command: 'Get-ChildItem' }))).toMatchObject({ op: 'read', language: 'powershell' });
    expect(toOperation(tool('Agent', { prompt: 'x' }))).toBeNull();
  });
});
