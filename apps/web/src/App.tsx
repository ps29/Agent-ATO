import { useEffect } from 'react';
import { ControlBar } from './components/ControlBar';
import { DesignToggle } from './components/DesignToggle';
import { DisplaySettings } from './components/DisplaySettings';
import { HaltButton } from './components/HaltButton';
import { Mascot } from './components/Mascot';
import { Palette } from './components/Palette';
import { Sidebar } from './components/Sidebar';
import { useStore, type View } from './store';
import { Audit } from './views/Audit';
import { Feed } from './views/Feed';
import { Guard } from './views/Guard';
import { Live } from './views/Live';
import { Log } from './views/Log';
import { Memory } from './views/Memory';
import { Operations } from './views/Operations';
import { Reasoning } from './views/Reasoning';
import { Stats } from './views/Stats';

const VIEWS: { id: View; label: string }[] = [
  { id: 'live', label: 'Live' }, { id: 'feed', label: 'Feed' }, { id: 'ops', label: 'Operations' },
  { id: 'reasoning', label: 'Reasoning' }, { id: 'audit', label: 'Audit' }, { id: 'guard', label: 'Guard' }, { id: 'log', label: 'Log' }, { id: 'stats', label: 'Stats' }, { id: 'memory', label: 'Memory' },
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
        <h1><Mascot />Agent ATO</h1>
        <div className="tabs">
          {VIEWS.map((v) => (<button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}>{v.label}</button>))}
        </div>
        <span className="spacer" />
        <button onClick={() => setPalette(true)}>Search <kbd>Ctrl K</kbd></button>
        <HaltButton />
        <DesignToggle />
        <DisplaySettings />
        <ControlBar />
        <span title={connected ? 'Receiving live events' : 'Reconnecting…'}><span className={`dot ${connected ? 'live' : ''}`} /> {connected ? 'connected' : 'offline'}</span>
      </header>
      <Sidebar />
      <main className="main">
        {view === 'live' && <Live />}
        {view === 'feed' && <Feed />}
        {view === 'ops' && <Operations />}
        {view === 'reasoning' && <Reasoning />}
        {view === 'audit' && <Audit />}
        {view === 'guard' && <Guard />}
        {view === 'log' && <Log />}
        {view === 'stats' && <Stats />}
        {view === 'memory' && <Memory />}
      </main>
      <Palette />
    </div>
  );
}
