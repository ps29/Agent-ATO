import type { Risk } from '@agent-ato/shared';
import { useEffect, useState } from 'react';
import { api, type AuditRow, type GuardMode, type GuardRule } from '../api';
import { RiskBadge } from '../components/RiskBadge';
import { useStore } from '../store';

const MODES: { id: GuardMode; label: string; blurb: string }[] = [
  { id: 'off', label: 'Off', blurb: 'Never intervene. Only the Halt button still works.' },
  { id: 'monitor', label: 'Monitor', blurb: 'Allow everything, but record what Guard would have blocked. Start here.' },
  { id: 'enforce', label: 'Enforce', blurb: 'Deny or ask before risky actions run.' },
];
const LEVELS: (Risk | '')[] = ['', 'medium', 'high', 'critical'];

const blank: { name: string; kind: 'contains' | 'regex'; pattern: string; tool: string; action: 'deny' | 'ask' } = { name: '', kind: 'contains', pattern: '', tool: '', action: 'deny' };

/** Rules and thresholds for stopping the agent, plus the decisions Guard has made. */
export function Guard() {
  const guard = useStore((s) => s.guard);
  const refresh = useStore((s) => s.refreshGuard);
  const feedSize = useStore((s) => s.feed.length);
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [decisions, setDecisions] = useState<AuditRow[]>([]);
  const [lastHook, setLastHook] = useState<number | null>(null);

  useEffect(() => {
    void refresh();
    const t = setTimeout(() => {
      void api.audit({ kind: 'guard' }).then((r) => setDecisions(r.rows.slice(0, 30)), () => undefined);
    }, 300);
    return () => clearTimeout(t);
  }, [refresh, feedSize]);

  useEffect(() => {
    void api.guard().then((g) => setLastHook(g.lastHookMs), () => undefined);
  }, [feedSize]);

  if (!guard) return <div className="card muted">Guard is unavailable on this server.</div>;
  const { config, rules } = guard;
  const set = (patch: Parameters<typeof api.putGuard>[0]): void => void api.putGuard(patch).finally(() => void refresh());

  const add = (): void => {
    setError('');
    api.addRule({ name: form.name.trim() || form.pattern.trim(), kind: form.kind, pattern: form.pattern.trim(), tool: form.tool.trim() || null, action: form.action, enabled: true })
      .then(() => { setForm(blank); return refresh(); })
      .catch(() => setError('The server rejected this rule. Check that the pattern is not empty and that a regular expression is valid.'));
  };

  const hooksSeen = lastHook !== null && Date.now() - lastHook < 24 * 3600_000;

  return (
    <div className="oplist">
      <div className="card">
        <div className="tabs">
          <b>Guard</b>
          <span className="muted">stop the agent before it does something you do not want</span>
        </div>
        <div className={`notice ${hooksSeen ? 'good' : 'bad'}`} role="status">
          {hooksSeen
            ? `Hooks are connected (last event ${new Date(lastHook!).toLocaleString()}). Guard can act on new tool calls.`
            : 'No hook events received in the last 24 hours, so Guard cannot stop anything yet. Install the hooks, then start a new Claude Code session. The audit log and risk labels work without hooks.'}
        </div>
        <div className="muted" style={{ marginBottom: 8 }}>
          Install with <code>node apps/server/dist/cli.js install-hooks</code>. Guard only denies or asks; it never auto-approves, so Claude Code’s own permission
          prompts still apply. It cannot interrupt a command that is already running, and if this server is down the hooks let everything through.
        </div>

        <fieldset className="modes">
          <legend>Mode</legend>
          {MODES.map((m) => (
            <label key={m.id} className={config.mode === m.id ? 'on' : ''}>
              <input type="radio" name="mode" checked={config.mode === m.id} onChange={() => set({ mode: m.id })} />
              <b>{m.label}</b>
              <span className="muted">{m.blurb}</span>
            </label>
          ))}
        </fieldset>

        <div className="tabs" style={{ marginTop: 10 }}>
          <label>
            Deny actions rated at least{' '}
            <select value={config.denyAtLeast ?? ''} onChange={(e) => set({ denyAtLeast: (e.target.value || null) as Risk | null })}>
              {LEVELS.map((l) => <option key={l} value={l}>{l || 'never'}</option>)}
            </select>
          </label>
          <label>
            Ask me for actions rated at least{' '}
            <select value={config.askAtLeast ?? ''} onChange={(e) => set({ askAtLeast: (e.target.value || null) as Risk | null })}>
              {LEVELS.map((l) => <option key={l} value={l}>{l || 'never'}</option>)}
            </select>
          </label>
        </div>
        <div className="muted" style={{ marginTop: 6 }}>
          Risk ratings come from reading the command text. They are a prompt for your attention, not a security boundary.
        </div>
      </div>

      <div className="card">
        <b>Rules</b>
        <div className="muted">A rule that matches wins over the risk thresholds. Matching ignores case.</div>
        <table>
          <thead><tr><th>On</th><th>Name</th><th>Match</th><th>Tool</th><th>Action</th><th /></tr></thead>
          <tbody>
            {rules.map((r: GuardRule) => (
              <tr key={r.id}>
                <td><input type="checkbox" checked={r.enabled} aria-label={`Enable ${r.name}`} onChange={(e) => void api.patchRule(r.id, { enabled: e.target.checked }).finally(() => void refresh())} /></td>
                <td>{r.name}</td>
                <td><span className="badge">{r.kind}</span> <code>{r.pattern}</code></td>
                <td>{r.tool ?? 'any'}</td>
                <td>{r.action}</td>
                <td><button onClick={() => void api.deleteRule(r.id).finally(() => void refresh())}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rules.length && <div className="muted">No rules yet.</div>}
        <div className="tabs ruleform">
          <input placeholder="Name (optional)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="Rule name" />
          <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'contains' | 'regex' })} aria-label="Match type">
            <option value="contains">contains</option><option value="regex">regex</option>
          </select>
          <input placeholder="Text to match in the command or path" value={form.pattern} onChange={(e) => setForm({ ...form, pattern: e.target.value })} aria-label="Pattern" />
          <input placeholder="Tool (any)" value={form.tool} onChange={(e) => setForm({ ...form, tool: e.target.value })} aria-label="Tool name" style={{ width: 110 }} />
          <select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value as 'deny' | 'ask' })} aria-label="Action">
            <option value="deny">deny</option><option value="ask">ask me</option>
          </select>
          <button className="active" disabled={!form.pattern.trim()} onClick={add}>Add rule</button>
        </div>
        {error && <div className="notice bad" role="alert">{error}</div>}
      </div>

      <div className="card">
        <b>Recent decisions</b>
        <table>
          <thead><tr><th>Time</th><th>Outcome</th><th>Risk</th><th>Tool</th><th>Target</th><th>Why</th></tr></thead>
          <tbody>
            {decisions.map((r) => {
              const d = (() => { try { return JSON.parse(r.detail ?? '{}') as { decision?: string; wouldHave?: string; reason?: string }; } catch { return {}; } })();
              return (
                <tr key={r.id}>
                  <td>{new Date(r.ts).toLocaleString()}</td>
                  <td>{d.wouldHave ? `would ${d.wouldHave}` : d.decision}</td>
                  <td><RiskBadge level={(r.risk ?? 'low') as Risk} showLow /></td>
                  <td>{r.tool}</td>
                  <td className="clip" title={r.target ?? ''}>{r.target}</td>
                  <td className="clip" title={d.reason}>{d.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!decisions.length && <div className="muted">Guard has not intervened yet.</div>}
      </div>
    </div>
  );
}
