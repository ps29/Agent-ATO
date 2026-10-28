import type { Interaction, Prompt, SessionMeta } from '@agent-ato/shared';
import { EventEmitter } from 'node:events';
import type { SessionRow } from '../store/repo.js';

export type ServerEvent =
  | { type: 'session'; session: SessionRow }
  | {
      type: 'interactions';
      sessionId: string;
      items: Interaction[];
      meta: SessionMeta;
      /** Present only when the prompt list changed. */
      prompts?: Prompt[];
    }
  | { type: 'hook'; sessionId: string | null; event: string; toolName: string | null; toolUseId: string | null; ts: number };

/** In-process pub/sub between ingest and the SSE endpoint. */
export class EventHub {
  private readonly em = new EventEmitter();

  constructor() {
    this.em.setMaxListeners(0);
  }

  publish(ev: ServerEvent): void {
    this.em.emit('event', ev);
  }

  subscribe(fn: (ev: ServerEvent) => void): () => void {
    this.em.on('event', fn);
    return () => this.em.off('event', fn);
  }
}
