import { useStore } from '../store';

export function AlertsPanel() {
  const alerts = useStore((s) => s.alerts);
  const feed = useStore((s) => s.alertFeed);
  const setAlerts = useStore((s) => s.setAlerts);
  const select = useStore((s) => s.select);
  const setFollow = useStore((s) => s.setFollow);

  return (
    <details className="card">
      <summary><b>Alerts</b> <span className="muted">{feed.length ? `${feed.length} this session` : 'none yet'}</span></summary>
      <div className="tabs" style={{ margin: '8px 0' }}>
        <label><input type="checkbox" checked={alerts.toolErrors} onChange={(e) => setAlerts({ toolErrors: e.target.checked })} /> tool errors</label>
        <label><input type="checkbox" checked={alerts.secretAccess} onChange={(e) => setAlerts({ secretAccess: e.target.checked })} /> .env / key / credential paths</label>
        <label><input type="checkbox" checked={alerts.highTokens} onChange={(e) => setAlerts({ highTokens: e.target.checked })} /> output tokens ≥
          <input type="text" size={6} value={alerts.tokenThreshold} onChange={(e) => setAlerts({ tokenThreshold: Number(e.target.value) || 0 })} /></label>
        <label>regex <input type="text" size={22} value={alerts.regex} placeholder="e.g. rm -rf|curl .*\|" onChange={(e) => setAlerts({ regex: e.target.value })} /></label>
        <label><input type="checkbox" checked={alerts.browserNotifications} onChange={(e) => setAlerts({ browserNotifications: e.target.checked })} /> browser notifications</label>
      </div>
      <div className="feed">
        {feed.map((a) => (
          <div key={a.key} className="session" onClick={() => { setFollow(false); void select(a.sessionId, a.index); }}>
            <span className="badge err">{a.kind}</span> {a.message} <span className="muted">· {new Date(a.ts).toLocaleTimeString()}</span>
          </div>
        ))}
        {!feed.length && <div className="muted">Alerts fire only for activity that arrives while this page is open.</div>}
      </div>
    </details>
  );
}
