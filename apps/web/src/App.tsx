import { useEffect } from 'react';
import { Palette } from './components/Palette';
import { Sidebar } from './components/Sidebar';
import { useStore, type View } from './store';
import { Live } from './views/Live';
import { Log } from './views/Log';
import { Memory } from './views/Memory';
import { Stats } from './views/Stats';

const VIEWS: { id: View; label: string }[] = [
  { id: 'live', label: 'Live' }, { id: 'log', label: 'Log' }, { id: 'stats', label: 'Stats' }, { id: 'memory', label: 'Memory' },
];

export function App() {
  const init = useStore((s) => s.init);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const setPalette = useStore((s) => s.setPalette);
  const connected = useStore((s) => s.connected);
  useEffect(init, [init]);

  return (
    <div className="app">
      <header className="header">
        <h1>Agent ATO</h1>
        <div className="tabs">
          {VIEWS.map((v) => (<button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}>{v.label}</button>))}
        </div>
        <span className="spacer" />
        <button onClick={() => setPalette(true)}>Search <kbd>Ctrl K</kbd></button>
        <span title={connected ? 'Receiving live events' : 'Reconnecting…'}><span className={`dot ${connected ? 'live' : ''}`} /> {connected ? 'connected' : 'offline'}</span>
      </header>
      <Sidebar />
      <main className="main">
        {view === 'live' && <Live />}
        {view === 'log' && <Log />}
        {view === 'stats' && <Stats />}
        {view === 'memory' && <Memory />}
      </main>
      <Palette />
    </div>
  );
}
