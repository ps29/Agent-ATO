/** Primary ATO categories from the Agent ATO paper (arXiv 2609.08301). */
export type Tag = 'D' | 'R' | 'W' | 'E';
export const TAG_ORDER: readonly Tag[] = ['D', 'R', 'W', 'E'];
export const TAG_NAMES: Record<Tag, string> = {
  D: 'Discovery',
  R: 'Reading',
  W: 'Writing',
  E: 'Execution',
};

/** Extra categories that do not replace the primary tags. */
export type Category = 'delegation' | 'interaction' | 'web' | 'mcp';

export interface Classification {
  tags: Tag[];
  label: string;
  categories: Category[];
}

export type ToolStatus = 'pending' | 'ok' | 'error' | 'denied';

export interface ToolCall {
  id: string;
  name: string;
  label: string;
  tags: Tag[];
  categories: Category[];
  input: string;
  output: string;
  status: ToolStatus;
}

export interface Interaction {
  /** Stable key: the API requestId (or the record uuid when absent). */
  id: string;
  sessionId: string;
  index: number;
  label: string;
  tags: Tag[];
  categories: Category[];
  promptIndex: number;
  model: string | null;
  outputTokens: number;
  thinkingTokens: number;
  /** Estimated from text length (chars / 4); the transcript has no exact count. */
  toolResultTokensEst: number;
  contextTokens: number;
  startMs: number | null;
  endMs: number | null;
  thinkingMs: number | null;
  effort: string | null;
  narration: string;
  thinking: string;
  isSidechain: boolean;
  hasError: boolean;
  tools: ToolCall[];
}

export interface Prompt {
  index: number;
  /** Index of the first interaction that followed this prompt. */
  firstInteraction: number;
  ts: number | null;
  text: string;
}

export interface SessionMeta {
  sessionId: string;
  title: string | null;
  cwd: string | null;
  gitBranch: string | null;
  models: string[];
  startMs: number | null;
  endMs: number | null;
  compactions: number[];
}
