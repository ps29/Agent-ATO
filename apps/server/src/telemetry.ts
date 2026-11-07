import { metrics, SpanStatusCode, trace, type Attributes, type Counter, type Histogram, type Meter } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';

/**
 * OpenTelemetry for the server itself. Nothing is exported unless an OTLP endpoint is configured
 * (for example OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318). Without one, the API calls below
 * do nothing and cost almost nothing.
 *
 * Attributes must never carry prompts, code, file contents or file paths. See docs/telemetry.md.
 */

const SCOPE = 'agent-ato';
const ENDPOINT_VARS = [
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_METRICS_ENDPOINT',
] as const;

/** Hook event names are bounded by Claude Code. Anything else is grouped so a bad client cannot grow the label set. */
const KNOWN_HOOK_EVENTS = new Set([
  'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Stop', 'SubagentStop', 'SessionStart', 'Notification',
]);

export function telemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.OTEL_SDK_DISABLED === 'true') return false;
  return ENDPOINT_VARS.some((name) => Boolean(env[name]));
}

let sdk: NodeSDK | undefined;

/** Start the OpenTelemetry SDK if an endpoint is configured. Call once, early in startup. */
export function startTelemetry(env: NodeJS.ProcessEnv = process.env): boolean {
  if (sdk || !telemetryEnabled(env)) return false;
  // Traces and metrics are sent over OTLP/HTTP; the SDK reads the OTEL_* variables for endpoint, headers and service name.
  sdk = new NodeSDK({ serviceName: env.OTEL_SERVICE_NAME ?? SCOPE });
  sdk.start();
  // Instruments created before the SDK registers its meter provider stay no-ops, so rebuild them now.
  Object.assign(instruments, createInstruments(metrics.getMeter(SCOPE)));
  return true;
}

/** Flush pending data and stop the SDK. Safe to call when telemetry was never started. */
export async function shutdownTelemetry(): Promise<void> {
  const current = sdk;
  sdk = undefined;
  if (current) await current.shutdown();
}

const tracer = trace.getTracer(SCOPE);

export interface Instruments {
  ingestDuration: Histogram;
  ingestErrors: Counter;
  archiveErrors: Counter;
  auditRows: Counter;
  hookEvents: Counter;
  guardDecisions: Counter;
  httpDuration: Histogram;
}

function createInstruments(meter: Meter): Instruments {
  return {
    ingestDuration: meter.createHistogram('agent_ato.ingest.duration', { unit: 'ms', description: 'Time to read and store new transcript bytes' }),
    ingestErrors: meter.createCounter('agent_ato.ingest.errors', { description: 'Transcript ingest runs that failed' }),
    archiveErrors: meter.createCounter('agent_ato.archive.errors', { description: 'Transcript archive runs that failed' }),
    auditRows: meter.createCounter('agent_ato.audit.rows', { description: 'Audit log rows written, by kind' }),
    hookEvents: meter.createCounter('agent_ato.hook.events', { description: 'Hook events received, by event name' }),
    guardDecisions: meter.createCounter('agent_ato.guard.decisions', { description: 'Guard decisions on tool calls' }),
    httpDuration: meter.createHistogram('agent_ato.http.duration', { unit: 'ms', description: 'HTTP request duration, by route' }),
  };
}

export const instruments: Instruments = createInstruments(metrics.getMeter(SCOPE));

export function hookEventAttribute(name: string): string {
  return KNOWN_HOOK_EVENTS.has(name) ? name : 'other';
}

/** Run fn inside a span and record its duration in ms on the histogram. */
export function measure<T>(spanName: string, histogram: Histogram | undefined, attributes: Attributes, fn: () => T): T {
  const span = tracer.startSpan(spanName, { attributes });
  const started = performance.now();
  try {
    return fn();
  } catch (e) {
    span.recordException(e as Error);
    span.setStatus({ code: SpanStatusCode.ERROR });
    throw e;
  } finally {
    histogram?.record(performance.now() - started, attributes);
    span.end();
  }
}
