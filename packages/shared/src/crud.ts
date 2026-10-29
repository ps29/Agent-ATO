import { classifyShell } from './classify/shell.js';
import type { ToolCall } from './types.js';

/** What a tool call did to the world. `run` is a command that is not file CRUD (tests, builds, scripts). */
export type CrudOp = 'create' | 'read' | 'update' | 'delete' | 'run';

export const CRUD_OPS: CrudOp[] = ['create', 'read', 'update', 'delete', 'run'];

export interface Operation {
  op: CrudOp;
  tool: string;
  /** File path, search pattern, URL or the command's first words. */
  target: string;
  /** highlight.js language id for `code`. */
  language: string;
  /** The code or command, ready to show in a code box. */
  code: string;
  /** True when Claude Code's capped transcript copy cut the input short. */
  truncated: boolean;
}

const EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  json: 'json', py: 'python', md: 'markdown', css: 'css', html: 'xml', xml: 'xml', svg: 'xml',
  yml: 'yaml', yaml: 'yaml', sh: 'bash', bash: 'bash', ps1: 'powershell', sql: 'sql', toml: 'ini', ini: 'ini',
  java: 'java', go: 'go', rs: 'rust', c: 'c', h: 'c', cpp: 'cpp', cs: 'csharp', rb: 'ruby', php: 'php',
  diff: 'diff', patch: 'diff',
};

export function languageFor(path: string): string {
  const ext = /\.([A-Za-z0-9]+)$/.exec(path)?.[1]?.toLowerCase();
  return (ext && EXT[ext]) || 'plaintext';
}

/** Pull one string field out of JSON that may have been cut off mid-value. */
function field(raw: string, key: string): string | null {
  const m = new RegExp(`"${key}":\\s*"((?:[^"\\\\]|\\\\.)*)`).exec(raw);
  if (!m) return null;
  try {
    return JSON.parse(`"${m[1]}"`) as string;
  } catch {
    return m[1]!.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
}

function parseInput(raw: string): { obj: Record<string, unknown>; truncated: boolean } {
  try {
    const v: unknown = JSON.parse(raw);
    if (v && typeof v === 'object') return { obj: v as Record<string, unknown>, truncated: false };
  } catch {
    /* fall through to the field scraper */
  }
  const obj: Record<string, unknown> = {};
  for (const k of ['file_path', 'notebook_path', 'content', 'old_string', 'new_string', 'command', 'pattern', 'path', 'url', 'query', 'new_source']) {
    const v = field(raw, k);
    if (v !== null) obj[k] = v;
  }
  return { obj, truncated: true };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function diffOf(oldS: string, newS: string): string {
  const mark = (s: string, p: string): string => (s ? s.split('\n').map((l) => `${p} ${l}`).join('\n') : '');
  return [mark(oldS, '-'), mark(newS, '+')].filter(Boolean).join('\n');
}

const DELETE_RE = /(^|[\s;&|(])(rm|rmdir|rd|del|erase|unlink|remove-item|ri)(\s|$)|\bgit\s+(rm|clean)\b/i;
const CREATE_RE =
  /(^|[\s;&|(])(mkdir|md|touch|new-item|ni|cp|copy|copy-item)(\s|$)|\bgit\s+(init|clone)\b|(^|[^0-9&>])>(?![>&])\s*(?!\/dev\/null|\$null)[^\s>]/i;

/** File CRUD for a shell command. Heuristic: it reads the command text, not what the shell really did. */
export function shellOp(command: string): CrudOp {
  const { tags } = classifyShell(command);
  if (tags.has('W')) {
    if (DELETE_RE.test(command)) return 'delete';
    if (CREATE_RE.test(command)) return 'create';
    return 'update';
  }
  if (tags.has('R') || tags.has('D')) return 'read';
  return 'run';
}

/** Describe one tool call as a CRUD operation with displayable code. Returns null for tools with no code to show. */
export function toOperation(t: Pick<ToolCall, 'name' | 'input' | 'output'>): Operation | null {
  const { obj, truncated } = parseInput(t.input);
  const path = str(obj.file_path) || str(obj.notebook_path);
  const make = (op: CrudOp, target: string, language: string, code: string): Operation => ({
    op, tool: t.name, target, language, code, truncated,
  });

  switch (t.name) {
    case 'Bash':
    case 'PowerShell': {
      const cmd = str(obj.command);
      if (!cmd) return null;
      const first = cmd.split('\n')[0]!.trim();
      return make(shellOp(cmd), first.length > 90 ? `${first.slice(0, 90)}…` : first, t.name === 'Bash' ? 'bash' : 'powershell', cmd);
    }
    case 'Write':
      return make(/updated|overwrit/i.test(t.output) ? 'update' : 'create', path, languageFor(path), str(obj.content));
    case 'Edit':
      return make('update', path, 'diff', diffOf(str(obj.old_string), str(obj.new_string)));
    case 'MultiEdit': {
      const edits = Array.isArray(obj.edits) ? (obj.edits as Record<string, unknown>[]) : [];
      return make('update', path, 'diff', edits.map((e) => diffOf(str(e.old_string), str(e.new_string))).join('\n'));
    }
    case 'NotebookEdit':
      return make('update', path, 'python', str(obj.new_source));
    case 'Read':
    case 'NotebookRead':
      return make('read', path, languageFor(path), t.output.replace(/^ *\d+[\t→]/gm, ''));
    case 'Grep':
      return make('read', str(obj.pattern), 'plaintext', [str(obj.pattern), str(obj.path)].filter(Boolean).join('   in   '));
    case 'Glob':
      return make('read', str(obj.pattern), 'plaintext', str(obj.pattern));
    case 'WebFetch':
      return make('read', str(obj.url), 'plaintext', str(obj.url));
    case 'WebSearch':
      return make('read', str(obj.query), 'plaintext', str(obj.query));
    default:
      return null;
  }
}
