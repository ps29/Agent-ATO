import { classifyTool } from '../classify/index.js';
import type { Interaction, Prompt, SessionMeta, ToolCall } from '../types.js';
import { TAG_ORDER } from '../types.js';

type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const DETAIL_CAP = 3000;
const cap = (s: string, n = DETAIL_CAP): string =>
  s.length <= n ? s : `${s.slice(0, n)}\n... [${s.length - n} more chars]`;

const toMs = (ts: unknown): number | null => {
  if (typeof ts !== 'string') return null;
  const n = Date.parse(ts);
  return Number.isNaN(n) ? null : n;
};

function resultText(content: unknown): { text: string; images: number } {
  if (typeof content === 'string') return { text: content, images: 0 };
  let text = '';
  let images = 0;
  for (const b of Array.isArray(content) ? content : []) {
    if (b?.type === 'text') text += `${text ? '\n' : ''}${b.text ?? ''}`;
    else if (b?.type === 'image') images++;
  }
  return { text, images };
}

function promptText(content: unknown): string {
  if (typeof content === 'string') return content;
  return (Array.isArray(content) ? content : [])
    .filter((b) => b?.type === 'text')
    .map((b) => b.text ?? '')
    .join('\n');
}

export interface ParserOptions {
  /** Keep records from sub-agent (sidechain) transcripts. Default true. */
  includeSidechains?: boolean;
}

/**
 * Incremental parser for one Claude Code transcript.
 *
 * Feed it raw text in arbitrary chunks; a partial trailing line is held back until it completes.
 * One API response is split over several records sharing a requestId, so records are grouped by
 * requestId and usage is counted once. Tool results are joined back by tool_use_id and may
 * update an earlier interaction.
 */
export class TranscriptParser {
  readonly items: Interaction[] = [];
  readonly prompts: Prompt[] = [];
  readonly meta: SessionMeta;
  private pending = '';
  private byRequest = new Map<string, number>();
  private byTool = new Map<string, [number, number]>();
  private promptIndex = -1;
  private readonly includeSidechains: boolean;

  constructor(sessionId: string, opts: ParserOptions = {}) {
    this.includeSidechains = opts.includeSidechains ?? true;
    this.meta = {
      sessionId,
      title: null,
      cwd: null,
      gitBranch: null,
      models: [],
      startMs: null,
      endMs: null,
      compactions: [],
    };
  }

  /** Feed a text chunk. Returns the indices of interactions created or changed. */
  feed(chunk: string): number[] {
    const text = this.pending + chunk;
    const lines = text.split('\n');
    this.pending = lines.pop() ?? '';
    const changed = new Set<number>();
    for (const line of lines) this.feedLine(line, changed);
    return [...changed].sort((a, b) => a - b);
  }

  /** Flush a final line that has no trailing newline (use when a file is known to be complete). */
  end(): number[] {
    const changed = new Set<number>();
    if (this.pending.trim()) this.feedLine(this.pending, changed);
    this.pending = '';
    return [...changed].sort((a, b) => a - b);
  }

  private feedLine(line: string, changed: Set<number>): void {
    if (!line.trim()) return;
    let rec: Rec;
    try {
      rec = JSON.parse(line);
    } catch {
      return;
    }
    const type = rec.type;
    if (type === 'ai-title') {
      this.meta.title = rec.aiTitle ?? this.meta.title;
      return;
    }
    if (type === 'system' && /compact/i.test(String(rec.subtype ?? ''))) {
      this.meta.compactions.push(this.items.length);
      return;
    }
    if (type !== 'user' && type !== 'assistant') return;
    if (rec.isSidechain && !this.includeSidechains) return;

    const ts = toMs(rec.timestamp);
    if (ts !== null) {
      const m = this.meta;
      m.startMs = m.startMs === null ? ts : Math.min(m.startMs, ts);
      m.endMs = m.endMs === null ? ts : Math.max(m.endMs, ts);
    }
    this.meta.cwd ??= rec.cwd ?? null;
    this.meta.gitBranch ??= rec.gitBranch ?? null;
    const msg: Rec = rec.message ?? {};

    if (type === 'user') this.onUser(rec, msg, ts, changed);
    else this.onAssistant(rec, msg, ts, changed);
  }

  private onUser(rec: Rec, msg: Rec, ts: number | null, changed: Set<number>): void {
    const content = msg.content;
    const blocks: Rec[] = Array.isArray(content) ? content : [];
    const results = blocks.filter((b) => b?.type === 'tool_result');
    if (results.length) {
      for (const b of results) {
        const ref = this.byTool.get(b.tool_use_id);
        if (!ref) continue;
        const it = this.items[ref[0]]!;
        const tool = it.tools[ref[1]]!;
        const { text, images } = resultText(b.content);
        tool.output = cap(text) + (images ? `\n[${images} image(s)]` : '');
        tool.status = b.is_error ? 'error' : 'ok';
        it.toolResultTokensEst += Math.ceil(text.length / 4) + images * 1500;
        it.hasError ||= Boolean(b.is_error);
        if (ts !== null) it.endMs = Math.max(it.endMs ?? ts, ts);
        changed.add(ref[0]);
      }
      return;
    }
    if (rec.isMeta) return;
    if (rec.isCompactSummary) {
      this.meta.compactions.push(this.items.length);
      return;
    }
    const text = promptText(content).trim();
    if (!text || /^<local-command|^\[Request interrupted/.test(text)) return;
    this.prompts.push({
      index: this.prompts.length,
      firstInteraction: this.items.length,
      ts,
      text: cap(text, 2000),
    });
    this.promptIndex = this.prompts.length - 1;
  }

  private onAssistant(rec: Rec, msg: Rec, ts: number | null, changed: Set<number>): void {
    if (msg.model === '<synthetic>') return;
    const rid: string = rec.requestId ?? msg.id ?? rec.uuid ?? `anon-${this.items.length}`;
    let idx = this.byRequest.get(rid);
    if (idx === undefined) {
      idx = this.items.length;
      this.byRequest.set(rid, idx);
      this.items.push({
        id: rid,
        sessionId: this.meta.sessionId,
        index: idx,
        label: '',
        tags: [],
        categories: [],
        promptIndex: this.promptIndex,
        model: msg.model ?? null,
        outputTokens: 0,
        thinkingTokens: 0,
        toolResultTokensEst: 0,
        contextTokens: 0,
        startMs: ts,
        endMs: ts,
        thinkingMs: null,
        effort: rec.effort ?? null,
        narration: '',
        thinking: '',
        isSidechain: Boolean(rec.isSidechain),
        hasError: false,
        tools: [],
      });
      if (msg.model && !this.meta.models.includes(msg.model)) this.meta.models.push(msg.model);
    }
    const it = this.items[idx]!;
    if (ts !== null) it.endMs = Math.max(it.endMs ?? ts, ts);
    if (typeof rec.thinkingDurationMs === 'number') it.thinkingMs = rec.thinkingDurationMs;

    const u: Rec = msg.usage ?? {};
    it.outputTokens = Math.max(it.outputTokens, u.output_tokens ?? 0);
    it.thinkingTokens = Math.max(it.thinkingTokens, u.output_tokens_details?.thinking_tokens ?? 0);
    it.contextTokens = Math.max(
      it.contextTokens,
      (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
    );
    it.thinkingTokens = Math.min(it.thinkingTokens, it.outputTokens);

    for (const b of Array.isArray(msg.content) ? (msg.content as Rec[]) : []) {
      if (b?.type === 'thinking') it.thinking = cap(it.thinking + (b.thinking ?? ''));
      else if (b?.type === 'text') it.narration = cap(it.narration + (b.text ?? ''));
      else if (b?.type === 'tool_use' && !this.byTool.has(b.id)) {
        const c = classifyTool(String(b.name ?? '?'), b.input);
        let input: string;
        try {
          input = JSON.stringify(b.input, null, 1) ?? '';
        } catch {
          input = String(b.input);
        }
        const tool: ToolCall = {
          id: String(b.id),
          name: String(b.name ?? '?'),
          label: c.label,
          tags: c.tags,
          categories: c.categories,
          input: cap(input, DETAIL_CAP / 2),
          output: '',
          status: 'pending',
        };
        this.byTool.set(tool.id, [idx, it.tools.length]);
        it.tools.push(tool);
      }
    }
    this.summarize(it);
    changed.add(idx);
  }

  private summarize(it: Interaction): void {
    const tags = new Set(it.tools.flatMap((t) => t.tags));
    it.tags = TAG_ORDER.filter((t) => tags.has(t));
    it.categories = [...new Set(it.tools.flatMap((t) => t.categories))];
    const labels = [...new Set(it.tools.map((t) => t.label))];
    if (labels.length) {
      it.label =
        labels.length <= 3 ? labels.join(' + ') : `${labels.slice(0, 3).join(' + ')} +${labels.length - 3}`;
    } else it.label = it.narration.trim() ? '(reply)' : '(thinking)';
  }
}
