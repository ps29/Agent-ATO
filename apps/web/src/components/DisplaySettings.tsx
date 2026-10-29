import { useEffect, useRef, useState } from 'react';
import { THEMES, useSettings, type CodeFont, type ThemeId, type UiFont } from '../settings';

/** Header popover for theme, fonts and text readability. Changes apply and persist immediately. */
export function DisplaySettings() {
  const [open, setOpen] = useState(false);
  const s = useSettings();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent): void => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="popwrap" ref={box}>
      <button onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="dialog">
        Display
      </button>
      {open && (
        <div className="popover" role="dialog" aria-label="Display settings">
          <label>
            Theme
            <select value={s.theme} onChange={(e) => s.patch({ theme: e.target.value as ThemeId })}>
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Interface font
            <select value={s.uiFont} onChange={(e) => s.patch({ uiFont: e.target.value as UiFont })}>
              <option value="system">System</option>
              <option value="atkinson">Atkinson Hyperlegible</option>
              <option value="dyslexic">OpenDyslexic</option>
            </select>
          </label>
          <label>
            Code font
            <select value={s.codeFont} onChange={(e) => s.patch({ codeFont: e.target.value as CodeFont })}>
              <option value="system">System monospace</option>
              <option value="jetbrains">JetBrains Mono</option>
              <option value="atkinson-mono">Atkinson Hyperlegible Mono</option>
              <option value="dyslexic">OpenDyslexic</option>
            </select>
          </label>
          <label>
            Text size: {s.size}px
            <input type="range" min={12} max={22} step={1} value={s.size} onChange={(e) => s.patch({ size: Number(e.target.value) })} />
          </label>
          <label>
            Line spacing: {s.lineHeight.toFixed(1)}
            <input type="range" min={1.2} max={2} step={0.1} value={s.lineHeight} onChange={(e) => s.patch({ lineHeight: Number(e.target.value) })} />
          </label>
          <label>
            Letter spacing: {s.spacing.toFixed(2)}em
            <input type="range" min={0} max={0.12} step={0.01} value={s.spacing} onChange={(e) => s.patch({ spacing: Number(e.target.value) })} />
          </label>
          <label className="row">
            <input type="checkbox" checked={s.bold} onChange={(e) => s.patch({ bold: e.target.checked })} /> Bold text
          </label>
          <label className="row">
            <input type="checkbox" checked={s.reduceMotion} onChange={(e) => s.patch({ reduceMotion: e.target.checked })} /> Reduce motion
          </label>
          <button onClick={s.reset}>Reset to defaults</button>
        </div>
      )}
    </div>
  );
}
