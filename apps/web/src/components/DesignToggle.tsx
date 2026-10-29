import { useSettings, type Design } from '../settings';

const OPTIONS: { id: Design; label: string }[] = [
  { id: 'original', label: 'Original' },
  { id: 'updated', label: 'Updated' },
];

/** Header switch between the original look and the updated one. Persists with the other display settings. */
export function DesignToggle() {
  const design = useSettings((s) => s.design);
  const patch = useSettings((s) => s.patch);
  return (
    <div className="seg" role="group" aria-label="Design">
      {OPTIONS.map((o) => (
        <button key={o.id} className={design === o.id ? 'active' : ''} aria-pressed={design === o.id} onClick={() => patch({ design: o.id })}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
