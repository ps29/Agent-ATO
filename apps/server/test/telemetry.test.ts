import { describe, expect, it } from 'vitest';
import { hookEventAttribute, measure, shutdownTelemetry, startTelemetry, telemetryEnabled } from '../src/telemetry.js';

describe('telemetry', () => {
  it('is off unless an OTLP endpoint is configured', () => {
    expect(telemetryEnabled({})).toBe(false);
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318' })).toBe(true);
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://x/v1/traces' })).toBe(true);
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: 'http://x/v1/metrics' })).toBe(true);
  });

  it('OTEL_SDK_DISABLED wins over an endpoint', () => {
    expect(telemetryEnabled({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318', OTEL_SDK_DISABLED: 'true' })).toBe(false);
  });

  it('starts nothing and shuts down cleanly when disabled', async () => {
    expect(startTelemetry({})).toBe(false);
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });

  it('bounds hook event labels to known names', () => {
    expect(hookEventAttribute('PreToolUse')).toBe('PreToolUse');
    expect(hookEventAttribute('made-up-by-a-client')).toBe('other');
  });

  it('measure returns the value and rethrows errors', () => {
    expect(measure('t', undefined, {}, () => 42)).toBe(42);
    expect(() => measure('t', undefined, {}, () => { throw new Error('boom'); })).toThrow('boom');
  });
});
