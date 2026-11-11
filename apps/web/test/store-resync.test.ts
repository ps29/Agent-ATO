import { beforeEach, describe, expect, it, vi } from 'vitest';

// A controllable EventSource so we can simulate the stream dropping and reconnecting.
class FakeES {
  static last: FakeES;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((m: { data: string }) => void) | null = null;
  constructor() { FakeES.last = this; }
}

const snap = (n: number) => ({
  session: { id: 's1', title: 't', cwd: null, gitBranch: null, models: [], startMs: 0, endMs: 1, compactions: [] },
  items: Array.from({ length: n }, (_, i) => ({ index: i, id: `i${i}`, sessionId: 's1', tags: [], tools: [] })),
  prompts: [],
});
let count = 1;
const apiMock = {
  sessions: vi.fn(async () => [{ id: 's1', nInteractions: count }]),
  session: vi.fn(async () => snap(count)),
  hooks: vi.fn(async () => []),
  log: vi.fn(async () => []),
};
vi.mock('../src/api', () => ({ api: new Proxy({}, { get: (_t, k: string) => (apiMock as Record<string, unknown>)[k] ?? vi.fn(async () => ({})) }) }));

beforeEach(() => {
  vi.stubGlobal('EventSource', FakeES);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => undefined });
  vi.resetModules();
  count = 1;
});

describe('stream reconnect', () => {
  it('reloads the open session after a reconnect, but not on the first open', async () => {
    const { useStore } = await import('../src/store');
    useStore.getState().init();
    await vi.waitFor(() => expect(useStore.getState().items).toHaveLength(1));

    FakeES.last.onopen!(); // first open: already covered by the initial loads
    await Promise.resolve();
    const callsAfterFirstOpen = apiMock.session.mock.calls.length;

    count = 4; // events happened while the stream was down
    FakeES.last.onerror!();
    FakeES.last.onopen!(); // reconnect
    await vi.waitFor(() => expect(useStore.getState().items).toHaveLength(4));
    expect(apiMock.session.mock.calls.length).toBe(callsAfterFirstOpen + 1);
    expect(useStore.getState().sessions[0]).toMatchObject({ nInteractions: 4 });
  });
});
