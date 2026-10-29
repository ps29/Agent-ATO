import { buildReport, CRUD_OPS, REPORT_KINDS, RISK_ORDER, type CrudOp, type Risk, type ReportKind } from '@agent-ato/shared';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Config } from './config.js';
import { toCsvRows } from './api/csv.js';
import { toCsv, toMarkdown } from './api/export.js';
import type { EventHub } from './ingest/hub.js';
import { allowedHosts, isContained, tokenMatches } from './security.js';
import { decide, validRegex, type GuardStore } from './guard.js';
import type { Audit } from './store/audit.js';
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

/** Process-level actions the UI may trigger. Provided by the CLI; absent in tests that do not need it. */
export interface Control {
  paused(): boolean;
  pause(): void;
  resume(): void;
  /** Exit cleanly; a supervisor (if any) will not restart. */
  stop(): void;
  /** Exit with the restart code so the supervisor starts a fresh process. */
  restart(): void;
  supervised: boolean;
}

export interface AppDeps {
  control?: Control;
  audit?: Audit;
  guard?: GuardStore;
  config: Config;
  repo: Repo;
  hub: EventHub;
  token: string;
  now?: () => number;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, repo, hub, token, control, audit, guard } = deps;
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

  // State-changing UI calls must carry a custom header (forces a CORS preflight that is never approved)
  // and, when the browser sends an Origin, it must be one of our own.
  const uiOnly = (req: FastifyRequest, reply: FastifyReply): boolean => {
    const origin = req.headers.origin;
    if (req.headers['x-agent-ato-ui'] !== '1' || (origin && !hosts.has((origin.split('//')[1] ?? '').toLowerCase()))) {
      void reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  };

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

  // One interaction with its tool inputs and outputs, for expanding a feed row.
  app.get<{ Querystring: { session?: string; idx?: string } }>('/api/interaction', async (req, reply) => {
    const idx = Number(req.query.idx);
    const it = req.query.session && Number.isInteger(idx) ? repo.getInteraction(req.query.session, idx) : null;
    return it ?? reply.code(404).send({ error: 'not found' });
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

  app.get<{ Querystring: { op?: string; session?: string; q?: string; risk?: string; before?: string } }>('/api/operations', async (req) =>
    repo.operations({
      ops: req.query.op ? (req.query.op.split(',').filter((o) => CRUD_OPS.includes(o as CrudOp)) as CrudOp[]) : undefined,
      sessionId: req.query.session,
      q: req.query.q,
      minRisk: RISK_ORDER.includes(req.query.risk as Risk) ? (req.query.risk as Risk) : undefined,
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

  // Draft SRE-style documents (post-incident review, RCA, change log, RFC) from one session.
  app.get<{ Querystring: { id?: string; kind?: string } }>('/api/report', async (req, reply) => {
    const snap = req.query.id ? repo.getSnapshot(req.query.id) : null;
    const kind = REPORT_KINDS.find((k) => k.id === req.query.kind)?.id as ReportKind | undefined;
    if (!snap || !kind) return reply.code(snap ? 400 : 404).send({ error: snap ? 'unknown report kind' : 'not found' });
    const guardEvents = (audit?.list({ kind: 'guard', sessionId: snap.session.id, limit: 200 }) ?? []).map((r) => {
      const d = r.detail ? (JSON.parse(r.detail) as { decision?: string; wouldHave?: string; reason?: string }) : {};
      return { ts: r.ts, tool: r.tool, target: r.target, decision: d.wouldHave ? 'would ' + d.wouldHave : (d.decision ?? 'allow'), reason: d.reason ?? '' };
    });
    const md = buildReport({ kind, session: snap.session, prompts: snap.prompts, items: snap.items, guard: guardEvents, generatedMs: now() });
    const name = snap.session.id.replace(/[^\w.-]+/g, '_') + '-' + kind;
    return reply.header('content-disposition', 'inline; filename="' + name + '.md"').type('text/markdown; charset=utf-8').send(md);
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

  // Process controls for the UI. The custom header cannot be sent cross-site without a CORS
  // preflight, which this server never approves, so other web pages cannot call these.
  app.get('/api/control', async () => ({ paused: control?.paused() ?? false, supervised: control?.supervised ?? false, available: !!control }));

  app.post<{ Params: { action: string } }>('/api/control/:action', async (req, reply) => {
    if (!control) return reply.code(404).send({ error: 'controls unavailable' });
    if (req.headers['x-agent-ato-ui'] !== '1') return reply.code(403).send({ error: 'missing header' });
    const origin = req.headers.origin;
    if (origin && !hosts.has((origin.split('//')[1] ?? '').toLowerCase())) return reply.code(403).send({ error: 'bad origin' });
    switch (req.params.action) {
      case 'pause':
      case 'resume':
        if (req.params.action === 'pause') control.pause();
        else control.resume();
        hub.publish({ type: 'control', paused: control.paused() });
        return { paused: control.paused() };
      case 'stop':
        setTimeout(() => control.stop(), 100);
        return { ok: true };
      case 'restart':
        if (!control.supervised) return reply.code(409).send({ error: 'not running under the supervisor; use npm start' });
        setTimeout(() => control.restart(), 100);
        return { ok: true };
      default:
        return reply.code(404).send({ error: 'unknown action' });
    }
  });

  // Audit log: append-only, hash-chained record of everything the agent did and every Guard decision.
  if (audit) {
    app.get<{ Querystring: { kind?: string; risk?: string; session?: string; q?: string; before?: string } }>('/api/audit', async (req) => ({
      rows: audit.list({
        kind: req.query.kind, risk: req.query.risk, sessionId: req.query.session, q: req.query.q,
        before: req.query.before ? Number(req.query.before) : undefined,
      }),
      total: audit.count(),
      head: audit.headHash,
    }));
    app.get('/api/audit/verify', async () => audit.verify());
    app.get<{ Querystring: { format?: string } }>('/api/audit/export', async (req, reply) => {
      const rows = audit.list({ limit: 500 });
      if (req.query.format === 'csv') {
        const header = ['id', 'time', 'kind', 'session', 'tool', 'op', 'risk', 'target', 'hash'];
        const body = rows.map((r) => [r.id, new Date(r.ts).toISOString(), r.kind, r.session_id, r.tool, r.op, r.risk, r.target, r.hash]);
        return reply.header('content-disposition', 'attachment; filename="audit.csv"').type('text/csv').send(toCsvRows([header, ...body]));
      }
      return reply.header('content-disposition', 'attachment; filename="audit.json"').send({ head: audit.headHash, rows });
    });
  }

  // Guard: decisions are made in /ingest/hook; these routes manage its settings.
  if (guard) {
    const level = z.enum(['low', 'medium', 'high', 'critical']);
    const configBody = z.object({
      mode: z.enum(['off', 'monitor', 'enforce']).optional(),
      halted: z.boolean().optional(),
      denyAtLeast: level.nullable().optional(),
      askAtLeast: level.nullable().optional(),
    });
    const ruleBody = z.object({
      name: z.string().min(1).max(80),
      kind: z.enum(['contains', 'regex']),
      pattern: z.string().min(1).max(300),
      tool: z.string().max(100).nullable().default(null),
      action: z.enum(['deny', 'ask']),
      enabled: z.boolean().default(true),
    });
    const note = (what: string, detail: unknown): void => {
      audit?.append({ ts: now(), kind: 'control', tool: 'guard', target: what, detail: JSON.stringify(detail) });
    };

    app.get('/api/guard', async () => ({ config: guard.config(), rules: guard.rules(), lastHookMs: repo.lastHookMs() }));

    app.put('/api/guard/config', async (req, reply) => {
      if (!uiOnly(req, reply)) return reply;
      const p = configBody.safeParse(req.body);
      if (!p.success) return reply.code(400).send({ error: 'bad config' });
      const cfg = guard.setConfig(p.data);
      note('config changed', p.data);
      hub.publish({ type: 'guard', halted: cfg.halted, mode: cfg.mode });
      return cfg;
    });

    app.post('/api/guard/rules', async (req, reply) => {
      if (!uiOnly(req, reply)) return reply;
      const p = ruleBody.safeParse(req.body);
      if (!p.success || (p.data.kind === 'regex' && !validRegex(p.data.pattern))) return reply.code(400).send({ error: 'bad rule' });
      const rule = guard.addRule(p.data);
      note('rule added', rule);
      return rule;
    });

    app.patch<{ Params: { id: string } }>('/api/guard/rules/:id', async (req, reply) => {
      if (!uiOnly(req, reply)) return reply;
      const p = ruleBody.partial().safeParse(req.body);
      if (!p.success || (p.data.kind === 'regex' && p.data.pattern && !validRegex(p.data.pattern))) return reply.code(400).send({ error: 'bad rule' });
      const rule = guard.updateRule(Number(req.params.id), p.data);
      if (!rule) return reply.code(404).send({ error: 'not found' });
      note('rule changed', rule);
      return rule;
    });

    app.delete<{ Params: { id: string } }>('/api/guard/rules/:id', async (req, reply) => {
      if (!uiOnly(req, reply)) return reply;
      if (!guard.deleteRule(Number(req.params.id))) return reply.code(404).send({ error: 'not found' });
      note('rule deleted', { id: req.params.id });
      return { ok: true };
    });
  }

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
    // Gate PreToolUse. Only deny or ask are ever returned: this never auto-approves, so Claude Code's
    // own permission prompts keep working.
    let verdict: Record<string, unknown> | null = null;
    const raw = b as Record<string, unknown>;
    if (guard && b.hook_event_name === 'PreToolUse' && b.tool_name) {
      const input = raw.tool_input && typeof raw.tool_input === 'object' ? (raw.tool_input as Record<string, unknown>) : {};
      const cfg = guard.config();
      const d = decide(cfg, guard.rules(), b.tool_name, input);
      if (d.decision !== 'allow' || d.wouldHave) {
        audit?.append({
          ts, kind: 'guard', sessionId: b.session_id ?? null, toolUseId: b.tool_use_id ?? null, tool: b.tool_name, risk: d.risk,
          target: String(input.command ?? input.file_path ?? b.tool_name),
          detail: JSON.stringify({ decision: d.decision, wouldHave: d.wouldHave, reason: d.reason, matched: d.matched, mode: cfg.mode, halted: cfg.halted }),
        });
      }
      if (d.decision !== 'allow') {
        verdict = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: d.decision, permissionDecisionReason: d.reason } };
      }
    }
    return { ok: true, ...(verdict ?? {}) };
  });

  if (config.webDir && existsSync(config.webDir)) {
    void app.register(fastifyStatic, { root: config.webDir });
  }
  return app;
}
