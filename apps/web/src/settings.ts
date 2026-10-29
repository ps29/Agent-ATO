import { create } from 'zustand';

export type ThemeId = 'system' | 'light' | 'dark' | 'solarized-light' | 'solarized-dark' | 'contrast';
export type UiFont = 'system' | 'atkinson' | 'dyslexic';
export type CodeFont = 'system' | 'jetbrains' | 'atkinson-mono' | 'dyslexic';

export interface Settings {
  theme: ThemeId;
  uiFont: UiFont;
  codeFont: CodeFont;
  /** Base text size in px. */
  size: number;
  /** Heavier text everywhere, including code. */
  bold: boolean;
  lineHeight: number;
  /** Extra letter spacing in em. */
  spacing: number;
  reduceMotion: boolean;
}

export const DEFAULTS: Settings = {
  theme: 'system', uiFont: 'system', codeFont: 'system', size: 14, bold: false, lineHeight: 1.5, spacing: 0, reduceMotion: false,
};

export const THEMES: { id: ThemeId; label: string }[] = [
  { id: 'system', label: 'Match system' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' },
  { id: 'solarized-light', label: 'Solarized Light' }, { id: 'solarized-dark', label: 'Solarized Dark' },
  { id: 'contrast', label: 'High contrast' },
];

const UI_STACKS: Record<UiFont, string> = {
  system: "system-ui, -apple-system, 'Segoe UI', sans-serif",
  atkinson: "'Atkinson Hyperlegible', system-ui, sans-serif",
  dyslexic: "'OpenDyslexic', 'Comic Sans MS', sans-serif",
};
const CODE_STACKS: Record<CodeFont, string> = {
  system: "ui-monospace, 'Cascadia Mono', Consolas, monospace",
  jetbrains: "'JetBrains Mono', ui-monospace, monospace",
  'atkinson-mono': "'Atkinson Hyperlegible Mono', ui-monospace, monospace",
  dyslexic: "'OpenDyslexic', ui-monospace, monospace",
};

const KEY = 'ato.settings';

function load(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

/** Write the settings onto <html> as a theme attribute and CSS variables. */
export function applySettings(s: Settings): void {
  const root = document.documentElement;
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = s.theme === 'system' ? (dark ? 'dark' : 'light') : s.theme;
  root.dataset.motion = s.reduceMotion ? 'reduced' : 'full';
  const set = (k: string, v: string): void => root.style.setProperty(k, v);
  set('--font-ui', UI_STACKS[s.uiFont]);
  set('--font-code', CODE_STACKS[s.codeFont]);
  set('--font-size', `${s.size}px`);
  set('--font-weight', s.bold ? '600' : '400');
  set('--font-weight-strong', s.bold ? '800' : '600');
  set('--line-height', String(s.lineHeight));
  set('--tracking', `${s.spacing}em`);
}

interface SettingsState extends Settings {
  patch: (p: Partial<Settings>) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...load(),
  patch(p) {
    set(p);
    persist(get());
  },
  reset() {
    set(DEFAULTS);
    persist(get());
  },
}));

function persist(s: Settings): void {
  applySettings(s);
  try {
    localStorage.setItem(KEY, JSON.stringify({
      theme: s.theme, uiFont: s.uiFont, codeFont: s.codeFont, size: s.size, bold: s.bold,
      lineHeight: s.lineHeight, spacing: s.spacing, reduceMotion: s.reduceMotion,
    }));
  } catch {
    /* storage unavailable: settings last for this tab only */
  }
}

/** Apply saved settings before first paint and follow the system theme while set to "system". */
export function initSettings(): void {
  applySettings(useSettings.getState());
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => applySettings(useSettings.getState()));
}
