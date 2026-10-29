import { api } from '../api';
import { useStore } from '../store';

/**
 * Emergency stop. While halted, the PreToolUse hook denies every tool call from every session.
 * It cannot interrupt a command that is already running: press Esc or Ctrl+C in that terminal for that.
 */
export function HaltButton() {
  const guard = useStore((s) => s.guard);
  const refresh = useStore((s) => s.refreshGuard);
  if (!guard) return null;
  const halted = guard.config.halted;
  const toggle = (): void => {
    void api.putGuard({ halted: !halted }).finally(() => void refresh());
  };
  return (
    <button
      className={halted ? 'halt halted' : 'halt'}
      onClick={toggle}
      aria-pressed={halted}
      title={halted ? 'All tool calls are being denied. Click to release.' : 'Deny every tool call from every session until released'}
    >
      {halted ? '■ HALTED: release' : '■ Halt agent'}
    </button>
  );
}
