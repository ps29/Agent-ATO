# OpenTelemetry

The server can export its own traces and metrics over OpenTelemetry (OTLP/HTTP). It is off by default. Nothing is sent
until you set an endpoint.

## Turn it on

Point the server at any OTLP/HTTP collector:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 npm start
```

The standard `OTEL_*` variables are read by the OpenTelemetry Node SDK, so these also work:

| Variable | Effect |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Base URL of the collector. Enables telemetry. |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` / `OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` | Per-signal URLs. Either one enables telemetry. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Headers for the collector, such as an auth token. |
| `OTEL_SERVICE_NAME` | Service name. Defaults to `agent-ato`. |
| `OTEL_METRIC_EXPORT_INTERVAL` | How often metrics are sent, in ms. |
| `OTEL_SDK_DISABLED=true` | Turns telemetry off even when an endpoint is set. |

With no endpoint, the server starts no exporter, and the instrumentation calls do nothing.

For a quick local look, any OTLP-compatible backend works, such as an OpenTelemetry Collector with a debug exporter
or Jaeger with OTLP enabled.

## What is recorded

Metrics:

| Name | Type | Labels | Meaning |
|---|---|---|---|
| `agent_ato.http.duration` | histogram, ms | `method`, `route`, `status` | Request time. `route` is the route template (for example `/api/audit/verify`), not the raw URL. |
| `agent_ato.hook.events` | counter | `event` | Hook events received. Unknown event names are grouped as `other`. |
| `agent_ato.guard.decisions` | counter | `decision`, `risk`, `mode`, `would_have` | Guard decisions on tool calls. |
| `agent_ato.audit.rows` | counter | `kind` | Audit log rows written. |
| `agent_ato.ingest.duration` | histogram, ms | none | Time to read and store new transcript bytes. |
| `agent_ato.ingest.errors` | counter | none | Ingest runs that failed. |
| `agent_ato.archive.errors` | counter | none | Archive runs that failed. |

Traces:

| Span | Attributes | Meaning |
|---|---|---|
| `transcript.ingest` | none | One transcript ingest run. |
| `guard.decide` | `tool` | One Guard decision. |

## What is never recorded

Telemetry is meant to describe how the server behaves, not what the agent did. It must not contain:

- prompts, commands, code, or tool inputs and outputs;
- file paths or file contents;
- session IDs, tool-use IDs, or anything else that identifies a particular conversation.

A test run against a local collector confirmed that a dangerous command sent in a hook payload did not appear in any
exported data. Keep this rule when you add instruments: counts, durations, and enumerated values only.

## Shutdown

On a clean stop (SIGINT, SIGTERM, or the Stop button), the server flushes pending spans and metrics before it exits.
A hard kill can lose up to one export interval of data.

## Code

- `apps/server/src/telemetry.ts`: SDK start and stop, instrument definitions, and the `measure` helper.
- `apps/server/test/telemetry.test.ts`: enable rules and the no-op path.
- Call sites: `app.ts` (HTTP, hooks, Guard), `ingest/watcher.ts` (ingest, archive), `store/audit.ts` (audit rows), `cli.ts` (start and flush).
