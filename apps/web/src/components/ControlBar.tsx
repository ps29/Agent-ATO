import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';

/** Pause/resume ingestion, restart and stop the server. */
export function ControlBar() {
  const control = useStore((s) => s.control);
  const connected = useStore((s) => s.connected);
  const refresh = useStore((s) => s.refreshControl);
  const [busy, setBusy] = useState(false);

  const run = async (
    action: 'pause' | 'resume' | 'stop' | 'restart',
    confirmText?: string,
  ): Promise<void> => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      await api.control(action);
    } catch {
      /* the server may exit before replying */
    } finally {
      setBusy(false);
      void refresh();
    }
  };

  if (!connected && !control) return null;
  if (!connected)
    return (
      <span className="muted">
        Server stopped. Start it again with <code>npm start</code>.
      </span>
    );
  if (!control?.available) return null;
  return (
    <span className="tabs">
      <button disabled={busy} onClick={() => run(control.paused ? 'resume' : 'pause')}>
        {control.paused ? 'Resume ingest' : 'Pause ingest'}
      </button>
      <button
        disabled={busy || !control.supervised}
        title={
          control.supervised ? 'Restart the server process' : 'Run with npm start to enable restart'
        }
        onClick={() => run('restart', 'Restart the Agent ATO server?')}
      >
        Restart
      </button>
      <button
        disabled={busy}
        title="Stop the server. Restart it from a terminal with npm start."
        onClick={() =>
          run('stop', 'Stop the Agent ATO server? You will need to start it again from a terminal.')
        }
      >
        Stop
      </button>
    </span>
  );
}
