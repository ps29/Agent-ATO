import type { Interaction, Prompt, SessionMeta } from '@agent-ato/shared';
import { create } from 'zustand';
import { evaluate, DEFAULT_ALERTS, type AlertConfig, type AlertHit } from './alerts';
import { api, type HookRow, type ServerEvent, type SessionRow } from './api';
import { mergeItems } from './timeline/math';

export type View = 'live' | 'log' | 'stats' | 'memory';

const load = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
};
const save = (key: string, v: unknown): void => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable */
  }
};

interface State {
  connected: boolean;
  sessions: SessionRow[];
  selectedId: string | null;
  items: Interaction[];
  prompts: Prompt[];
  meta: SessionMeta | null;
  hooks: HookRow[];
  /** tool_use_ids seen by PreToolUse hooks without a matching PostToolUse yet. */
  hookPending: Record<string, true>;
  view: View;
  followLatest: boolean;
  paletteOpen: boolean;
  selectedIndex: number | null;
  alerts: AlertConfig;
  alertFeed: (AlertHit & { ts: number })[];

  init: () => void;
  select: (id: string, index?: number | null) => Promise<void>;
  setView: (v: View) => void;
  setFollow: (b: boolean) => void;
  setPalette: (b: boolean) => void;
  setSelectedIndex: (i: number | null) => void;
  setAlerts: (a: Partial<AlertConfig>) => void;
}

const fired = new Set<string>();
let es: EventSource | null = null;

export const useStore = create<State>((set, get) => ({
  connected: false,
  sessions: [],
  selectedId: null,
  items: [],
  prompts: [],
  meta: null,
  hooks: [],
  hookPending: {},
  view: 'live',
  followLatest: true,
  paletteOpen: false,
  selectedIndex: null,
  alerts: load('ato.alerts', DEFAULT_ALERTS),
  alertFeed: [],

  init() {
    if (es) return;
    void api.sessions().then((sessions) => {
      set({ sessions });
      if (!get().selectedId && sessions[0]) void get().select(sessions[0].id);
    });
    es = new EventSource('/api/stream');
    es.onopen = () => set({ connected: true });
    es.onerror = () => set({ connected: false });
    es.onmessage = (m) => applyEvent(JSON.parse(m.data) as ServerEvent, set, get);
  },

  async select(id, index = null) {
    set({ selectedId: id, selectedIndex: index, items: [], prompts: [], meta: null, hooks: [], hookPending: {} });
    const [snap, hooks] = await Promise.all([api.session(id), api.hooks(id).catch(() => [])]);
    if (get().selectedId !== id) return; // user moved on while loading
    const s = snap.session;
    set({
      items: snap.items,
      prompts: snap.prompts,
      hooks,
      meta: {
        sessionId: s.id, title: s.title, cwd: s.cwd, gitBranch: s.gitBranch, models: s.models,
        startMs: s.startMs, endMs: s.endMs, compactions: s.compactions,
      },
    });
  },

  setView: (view) => set({ view }),
  setFollow: (followLatest) => set({ followLatest }),
  setPalette: (paletteOpen) => set({ paletteOpen }),
  setSelectedIndex: (selectedIndex) => set({ selectedIndex }),
  setAlerts(a) {
    const alerts = { ...get().alerts, ...a };
    save('ato.alerts', alerts);
    if (a.browserNotifications && 'Notification' in window && Notification.permission === 'default') {
      void Notification.requestPermission();
    }
    set({ alerts });
  },
}));

type Set = (p: Partial<State> | ((s: State) => Partial<State>)) => void;

function applyEvent(ev: ServerEvent, set: Set, get: () => State): void {
  if (ev.type === 'session') {
    const list = get().sessions.filter((s) => s.id !== ev.session.id);
    list.unshift(ev.session);
    list.sort((a, b) => b.updatedMs - a.updatedMs);
    set({ sessions: list });
    // Follow the newest active main session when the user has not pinned one.
    const s = get();
    if (s.followLatest && !ev.session.parentId && ev.session.active && s.selectedId !== ev.session.id) {
      void s.select(ev.session.id);
    }
    return;
  }
  if (ev.type === 'hook') {
    if (ev.sessionId !== get().selectedId) return;
    const id = ev.toolUseId;
    if (id) {
      const pending = { ...get().hookPending };
      if (ev.event === 'PreToolUse') pending[id] = true;
      else if (ev.event === 'PostToolUse') delete pending[id];
      set({ hookPending: pending });
    }
    return;
  }
  // interactions
  for (const it of ev.items) {
    for (const hit of evaluate(it, get().alerts)) {
      if (fired.has(hit.key)) continue;
      fired.add(hit.key);
      set((s) => ({ alertFeed: [{ ...hit, ts: Date.now() }, ...s.alertFeed].slice(0, 100) }));
      if (get().alerts.browserNotifications && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('Agent ATO', { body: hit.message });
      }
    }
  }
  if (ev.sessionId !== get().selectedId) return;
  set((s) => ({
    items: mergeItems(s.items, ev.items),
    prompts: ev.prompts ?? s.prompts,
    meta: ev.meta,
  }));
}
