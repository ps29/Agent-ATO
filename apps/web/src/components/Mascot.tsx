import { useEffect, useRef } from 'react';
import { useSettings } from '../settings';

/**
 * Header mascot for the Updated design. Its eyes follow the cursor, the antennae sway and it perks up on hover.
 * The pointer position goes straight into CSS variables, so moving the mouse never re-renders React.
 */
export function Mascot() {
  const design = useSettings((s) => s.design);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (design !== 'updated') return;
    let frame = 0;
    const move = (e: MouseEvent): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = ref.current;
        if (!el) return;
        const clamp = (n: number): number => Math.max(-1, Math.min(1, n));
        el.style.setProperty('--lx', String(clamp((e.clientX / window.innerWidth - 0.5) * 2)));
        el.style.setProperty('--ly', String(clamp((e.clientY / window.innerHeight - 0.5) * 2)));
      });
    };
    window.addEventListener('mousemove', move);
    return () => {
      window.removeEventListener('mousemove', move);
      cancelAnimationFrame(frame);
    };
  }, [design]);

  if (design !== 'updated') return null;
  return (
    <span className="mascot" ref={ref} aria-hidden="true">
      <span className="mascot-head">
        <span className="mascot-ant l" />
        <span className="mascot-ant r" />
        <span className="mascot-dome">
          <span className="mascot-eyes">
            <span className="mascot-eye" />
            <span className="mascot-eye" />
          </span>
        </span>
      </span>
    </span>
  );
}
