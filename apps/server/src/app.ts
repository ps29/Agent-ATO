import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from './config.js';
import { toCsv, toMarkdown } from './api/export.js';
import type { EventHub } from './ingest/hub.js';
import { allowedHosts, isContained, tokenMatches } from './security.js';
import type { Repo } from './store/repo.js';

const ACTIVE_MS = 60_000;

const hookBody = z
  .object({
    hook_event_name: z.string().max(100),
    session_id: z.string().max(200).optional(),
    tool_name: z.string().max(300).optional(),
    tool_use_id: z.string().max(200).optional(),
  })
  .passthrough();

export interface AppDeps {
  config: Config;
  repo: Repo;
  hub: EventHub;
  token: string;
  now?: () => number;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, repo, hub, token } = deps;
  const now = deps.now ?? Date.now;
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024 });
  const hosts = allowedHosts(config.port);
  const projectsRoot = join(config.claudeRoot, 'projects');

  // Reject unexpected Host headers (DNS rebinding). No CORS headers are ever sent.
  app.addHook('onRequest', async (req, reply) => {
    if (!hosts.has(String(req.headers.host ?? '').toLowerCase())) {
      return reply.code(403).send({ error: 'forbidden host' });
    }
  });

  const withActive = <T extends { updatedMs: number }>(s: T): T & { active: boolean } => ({
    ...s,
    active: now() - s.updatedMs < ACTIVE_MS,
  });

  app.get('/api/sessions', async () => repo.listSessions().map(withActive));

  app.get<{ Querystring: { id?: string } }>('/api/session', async (req, reply) => {
    const snap = req.query.id ? repo.getSnapshot(req.query.id) : null;
    if (!snap) return reply.code(404).send({ error: 'not found' });
    return { ...snap, session: withActive(snap.session) };
  });

  app.get<{ Querystring: { q?: string } }>('/api/search', async (req) => repo.search(req.query.q ?? ''));

  app.get<{ Querystring: { tag?: string; errors?: string; session?: string; before?: string } }>('/api/log', async (req) =>
    repo.log({
      tag: req.query.tag,
      errorsOnly: req.query.errors === '1',
      sessionId: req.query.session,
      before: req.query.before ? Number(req.query.before) : undefined,
    }),
  );

  app.get('/api/stats', async () => repo.stats());

  app.get<{ Querystring: { id?: string } }>('/api/hooks', async (req) => (req.query.id ? repo.hooks(req.query.id) : []));

  app.get<{ Querystring: { id?: string; format?: string } }>('/api/export', async (req, reply) => {
    const snap = req.query.id ? repo.getSnapshot(req.query.id) : null;
    if (!snap) return reply.code(404).send({ error: 'not found' });
    const name = snap.session.id.replace(/[^\w.-]+/g, '_');
    switch (req.query.format) {
      case 'csv':
        return reply.header('content-disposition', `attachment; filename="${name}.csv"`).type('text/csv').send(toCsv(snap));
      case 'md':
        return reply.header('content-disposition', `attachment; filename="${name}.md"`).type('text/markdown').send(toMarkdown(snap));
      default:
        return reply.header('content-disposition', `attachment; filename="${name}.json"`).send(snap);
    }
  });

  // MEMORY.md viewer: read-only, contained to <claude root>/projects/<project>/memory.
  app.get<{ Querystring: { project?: string } }>('/api/memory', async (req, reply) => {
    const dir = join(projectsRoot, req.query.project ?? '', 'memory');
    if (!req.query.project || !isContained(dir, [projectsRoot])) return reply.code(400).send({ error: 'bad project' });
    if (!existsSync(dir)) return { files: [] };
    const files = readdirSync(dir)
      .filter((f) => f.endsWith('.md') && statSync(join(dir, f)).size < 200_000)
      .map((f) => ({ name: f, content: readFileSync(join(dir, f), 'utf8') }));
    return { files };
  });

  // Server-sent events: session list changes and interaction deltas.
  app.get('/api/stream', (req, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    });
    res.write('retry: 2000\n\n');
    const send = (data: unknown): void => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    const unsub = hub.subscribe((ev) => {
      if (ev.type === 'session') send({ ...ev, session: withActive(ev.session) });
      else send(ev);
    });
    const beat = setInterval(() => res.write(': ping\n\n'), 15_000);
    req.raw.on('close', () => {
      clearInterval(beat);
      unsub();
    });
  });

  // Hook ingest. Requires the per-install token; never fails Claude Code on bad input.
  app.post('/ingest/hook', async (req, reply) => {
    if (!tokenMatches(token, req.headers['x-agent-ato-token'])) return reply.code(401).send({ error: 'unauthorized' });
    const parsed = hookBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'bad payload' });
    const b = parsed.data;
    const ts = now();
    repo.addHook({
      sessionId: b.session_id ?? null, event: b.hook_event_name, toolName: b.tool_name ?? null,
      toolUseId: b.tool_use_id ?? null, ts, payload: b,
    });
    hub.publish({
      type: 'hook', sessionId: b.session_id ?? null, event: b.hook_event_name,
      toolName: b.tool_name ?? null, toolUseId: b.tool_use_id ?? null, ts,
    });
    return { ok: true };
  });

  if (config.webDir && existsSync(config.webDir)) {
    void app.register(fastifyStatic, { root: config.webDir });
  }
  return app;
}
