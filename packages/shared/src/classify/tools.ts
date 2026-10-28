import type { Category, Classification, Tag } from '../types.js';
import { TAG_ORDER } from '../types.js';
import { classifyShell } from './shell.js';

const base = (p: unknown): string => String(p ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
const ordered = (s: Iterable<Tag>): Tag[] => {
  const set = new Set(s);
  return TAG_ORDER.filter((t) => set.has(t));
};
const make = (tags: Iterable<Tag>, label: string, categories: Category[] = []): Classification => ({
  tags: ordered(tags),
  label,
  categories,
});

/** Classify one tool_use block. Pure, no I/O. */
export function classifyTool(name: string, input: unknown): Classification {
  const inp = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (name === 'Bash' || name === 'PowerShell') {
    const { tags, label } = classifyShell(String(inp.command ?? ''));
    return make(tags, label);
  }
  switch (name) {
    case 'Read':
    case 'NotebookRead':
      return make(['R'], `Read ${base(inp.file_path ?? inp.notebook_path)}`);
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
      return make(['W'], `${name} ${base(inp.file_path ?? inp.notebook_path)}`);
    case 'Grep': {
      const content = inp.output_mode === 'content';
      return make([content ? 'R' : 'D'], `Grep (${content ? 'content' : 'files'})`);
    }
    case 'Glob':
      return make(['D'], 'Glob');
    case 'WebSearch':
      return make(['D'], name, ['web']);
    case 'WebFetch':
      return make(['R'], name, ['web']);
    case 'ToolSearch':
    case 'ListMcpResourcesTool':
      return make(['D'], name);
    case 'Agent':
    case 'Task': {
      const kind = String(inp.subagent_type ?? 'general');
      return make(kind === 'Explore' ? ['D'] : [], `Agent:${kind}`, ['delegation']);
    }
    case 'AskUserQuestion':
    case 'ExitPlanMode':
    case 'EnterPlanMode':
      return make([], name, ['interaction']);
  }
  if (name.startsWith('mcp__')) {
    const parts = name.split('__');
    const server = (parts[1] ?? 'mcp').replace(/^claude_ai_/, '');
    const tool = parts[parts.length - 1] ?? name;
    const low = tool.toLowerCase();
    let tags: Tag[] = [];
    if (/search|list|find|query/.test(low)) tags = ['D'];
    else if (/read|get|fetch|screenshot|text/.test(low)) tags = ['R'];
    else if (/create|update|delete|write|edit|set_|trash/.test(low)) tags = ['W'];
    return make(tags, `${server}:${tool}`, ['mcp']);
  }
  return make([], name);
}
