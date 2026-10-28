import type { Tag } from '../types.js';

const DISCOVERY = new Set([
  'ls', 'dir', 'find', 'fd', 'tree', 'where', 'which', 'du', 'stat', 'get-childitem', 'gci',
  'get-command', 'gcm', 'test-path', 'get-item', 'gi', 'resolve-path', 'realpath', 'pwd',
  'get-location',
]);
const READING = new Set([
  'cat', 'type', 'less', 'more', 'head', 'tail', 'bat', 'wc', 'jq', 'nl', 'get-content', 'gc',
  'od', 'xxd', 'file', 'awk', 'diff', 'cmp', 'import-csv', 'convertfrom-json', 'strings',
]);
const SEARCH = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag', 'ack', 'findstr', 'select-string', 'sls']);
const WRITING = new Set([
  'rm', 'rmdir', 'mv', 'cp', 'mkdir', 'touch', 'del', 'erase', 'ren', 'rename', 'copy', 'move',
  'chmod', 'chown', 'ln', 'tee', 'truncate', 'unzip', 'tar', 'patch', 'remove-item', 'ri',
  'set-content', 'sc', 'add-content', 'ac', 'out-file', 'new-item', 'ni', 'copy-item', 'cpi',
  'move-item', 'mi', 'rename-item', 'rni', 'clear-content', 'expand-archive',
]);
const NEUTRAL = new Set([
  'cd', 'set-location', 'sl', 'pushd', 'popd', 'echo', 'printf', 'write-output', 'write-host',
  'write-error', 'true', 'false', 'export', 'set', 'unset', 'sleep', 'start-sleep', 'exit', 'clear',
  'cls', 'source', 'date', 'get-date', 'out-null', 'out-string', 'out-host', 'select-object',
  'select', 'sort-object', 'sort', 'where-object', '?', 'foreach-object', '%', 'format-table',
  'ft', 'format-list', 'fl', 'measure-object', 'measure', 'group-object', 'uniq', 'cut', 'tr',
  'column', 'rev', 'base64', 'local', 'read', 'wait', 'convertto-json', 'join-path', 'split-path',
  'write-progress', 'test', '[', '[[',
]);
const INTERPRETERS = new Set([
  'python', 'python3', 'py', 'node', 'bash', 'sh', 'zsh', 'pwsh', 'powershell', 'ruby', 'perl',
  'deno', 'bun',
]);
const PREFIX = new Set(['sudo', 'env', 'time', 'nohup', 'command', 'builtin', 'exec', '&', '.', 'call']);
const GIT_DISCOVERY = new Set(['status', 'ls-files', 'ls-tree', 'branch', 'remote', 'rev-parse', 'worktree', 'describe', 'tag']);
const GIT_READING = new Set(['diff', 'log', 'show', 'blame', 'grep', 'cat-file', 'shortlog', 'reflog']);
const GIT_WRITING = new Set([
  'add', 'commit', 'checkout', 'switch', 'apply', 'reset', 'restore', 'merge', 'rebase', 'stash',
  'rm', 'mv', 'cherry-pick', 'revert', 'init', 'clone', 'pull', 'am', 'clean',
]);
const SUBCOMMAND_LABEL = new Set([
  'git', 'npm', 'pnpm', 'yarn', 'bun', 'cargo', 'go', 'dotnet', 'pip', 'pip3', 'poetry', 'docker',
  'kubectl', 'gh', 'make', 'uv', 'npx', 'deno', 'mvn', 'gradle', 'conda', 'winget',
]);

const QUOTED = /"(?:\\.|[^"\\])*"|'[^']*'/g;
const TOKEN = /"(?:\\.|[^"\\])*"|'[^']*'|\S+/g;
const REDIRECT = /(?<![\d&>])>{1,2}\s*(?!&|\/dev\/null|\$null|nul\b)\S/i;

/** Remove heredoc and PowerShell here-string bodies so their lines are not parsed as commands. */
export function stripBodies(cmd: string): string {
  return cmd
    .replace(/(<<-?\s*(['"]?)(\w+)\2)([^\n]*)\n[\s\S]*?\n[ \t]*\3[ \t]*(?=\n|$)/g, '$1$4')
    .replace(/@(['"])\r?\n[\s\S]*?\r?\n\1@/g, "@''@");
}

/** Split a command line into pipelines, each a list of segments. Quote-aware. */
export function splitShell(cmd: string): string[][] {
  const pipelines: string[][] = [];
  let segs: string[] = [];
  let buf = '';
  let quote: string | null = null;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i]!;
    if (quote) {
      buf += c;
      if (c === '\\' && quote === '"' && i + 1 < cmd.length) buf += cmd[++i];
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      buf += c;
    } else if (cmd.startsWith('&&', i) || cmd.startsWith('||', i) || c === ';' || c === '\n') {
      segs.push(buf);
      pipelines.push(segs);
      segs = [];
      buf = '';
      if (c === '&' || c === '|') i++;
    } else if (c === '|') {
      segs.push(buf);
      buf = '';
    } else buf += c;
  }
  segs.push(buf);
  pipelines.push(segs);
  return pipelines
    .map((p) => p.map((s) => s.trim()).filter(Boolean))
    .filter((p) => p.length > 0);
}

function word(tok: string): string {
  const w = tok.replace(/^["'()@]+|["'()]+$/g, '').split(/[\\/]/).pop()!.toLowerCase();
  return w.replace(/\.(exe|cmd|bat|ps1|com)$/, '');
}

function head(seg: string): { cmd: string; args: string[] } {
  let toks: string[] = seg.match(TOKEN) ?? [];
  while (toks.length) {
    const t = toks[0]!;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t)) toks = toks.slice(1);
    else if (t.startsWith('$') && toks[1] === '=') toks = toks.slice(2);
    else if (t.startsWith('$') && t.includes('=')) toks = toks.slice(1);
    else if (PREFIX.has(word(t)) && toks.length > 1) toks = toks.slice(1);
    else break;
  }
  if (!toks.length) return { cmd: '', args: [] };
  return { cmd: word(toks[0]!), args: toks.slice(1) };
}

const firstArg = (args: string[]): string => {
  const a = args.find((x) => !x.startsWith('-'));
  return a ? word(a) : '';
};

function segmentLabel(cmd: string, args: string[]): string {
  if (!cmd) return '';
  if (['python', 'python3', 'py', 'node', 'deno', 'bun'].includes(cmd)) {
    const mi = args.indexOf('-m');
    if (mi >= 0 && args[mi + 1]) return `${cmd} -m ${args[mi + 1]}`;
    if (args.includes('-c')) return `${cmd} -c`;
    const a = args.find((x) => !x.startsWith('-'));
    return a ? `${cmd} ${a.replace(/^["']|["']$/g, '').split(/[\\/]/).pop()}` : cmd;
  }
  if (SUBCOMMAND_LABEL.has(cmd)) {
    let sub = firstArg(args);
    if (['npm', 'pnpm', 'yarn', 'bun'].includes(cmd) && sub === 'run') {
      const after = args.slice(args.findIndex((a) => word(a) === 'run') + 1);
      sub = `run ${firstArg(after)}`.trim();
    }
    return `${cmd} ${sub}`.trim();
  }
  return cmd;
}

function classifySegment(seg: string, first: boolean): Set<Tag> {
  const tags = new Set<Tag>();
  if (REDIRECT.test(seg.replace(QUOTED, '""'))) tags.add('W');
  const { cmd, args } = head(seg);
  if (!cmd) return tags;
  if (cmd === 'xargs') {
    const rest = args.filter((a) => !a.startsWith('-')).join(' ');
    for (const t of classifySegment(rest, true)) tags.add(t);
    return tags;
  }
  if (WRITING.has(cmd)) return tags.add('W');
  if (!first) {
    if (INTERPRETERS.has(cmd)) tags.add('E');
    return tags;
  }
  if (cmd === 'git') {
    const sub = firstArg(args);
    if (GIT_READING.has(sub)) tags.add('R');
    else if (GIT_DISCOVERY.has(sub)) tags.add('D');
    else if (GIT_WRITING.has(sub)) tags.add('W');
    else tags.add('E');
    return tags;
  }
  if (SEARCH.has(cmd)) {
    const listOnly = args.some(
      (a) => a === '--files' || a === '--files-with-matches' || /^-[a-zA-Z]*[lL][a-zA-Z]*$/.test(a),
    );
    return tags.add(listOnly ? 'D' : 'R');
  }
  if (cmd === 'sed') return tags.add(args.some((a) => a.startsWith('-i') || a === '--in-place') ? 'W' : 'R');
  if (DISCOVERY.has(cmd)) tags.add('D');
  else if (READING.has(cmd)) tags.add('R');
  else if (!NEUTRAL.has(cmd)) tags.add('E');
  return tags;
}

export function classifyShell(command: string): { tags: Set<Tag>; label: string } {
  const tags = new Set<Tag>();
  const parts: string[] = [];
  for (const pipeline of splitShell(stripBodies(command ?? ''))) {
    const heads: string[] = [];
    pipeline.forEach((seg, j) => {
      for (const t of classifySegment(seg, j === 0)) tags.add(t);
      const { cmd, args } = head(seg);
      if (cmd && !['cd', 'set-location', 'sl', 'pushd', 'popd'].includes(cmd)) heads.push(segmentLabel(cmd, args));
    });
    if (heads.length) parts.push(heads.join(' | '));
  }
  let label = parts.join(' && ') || '(shell)';
  if (label.length > 60) label = `${label.slice(0, 57)}...`;
  return { tags, label };
}
