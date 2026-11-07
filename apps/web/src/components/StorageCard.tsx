import { useEffect, useState } from 'react';
import { api, type StorageInfo } from '../api';

const mb = (b: number): string => (b >= 1e9 ? `${(b / 1e9).toFixed(2)} GB` : `${(b / 1e6).toFixed(1)} MB`);

/** Where Agent ATO keeps its data and how much there is. */
export function StorageCard() {
  const [s, setS] = useState<StorageInfo | null>(null);
  useEffect(() => {
    api.storage().then(setS, () => setS(null));
  }, []);
  if (!s) return null;
  return (
    <div className="card">
      <b>Where your data is stored</b>
      <table>
        <thead>
          <tr><th>What</th><th>Location</th><th>Size</th><th>Holds</th></tr>
        </thead>
        <tbody>
          <tr>
            <td>Database</td>
            <td><code>{s.database.path}</code></td>
            <td>{mb(s.database.bytes)}</td>
            <td>{s.counts.sessions?.toLocaleString()} sessions, {s.counts.interactions?.toLocaleString()} interactions, {s.audit?.entries.toLocaleString()} audit entries, {s.counts.hookEvents} hook events, Guard rules</td>
          </tr>
          <tr>
            <td>Transcript archive</td>
            <td><code>{s.archive.path}</code></td>
            <td>{mb(s.archive.bytes)}</td>
            <td>{s.archive.files.toLocaleString()} compressed copies of the full transcripts (every word, tool input and output). Survives Claude Code deleting old sessions.</td>
          </tr>
          <tr>
            <td>Original transcripts</td>
            <td><code>{s.transcripts.path}</code></td>
            <td>read only</td>
            <td>Written by Claude Code, which may delete old ones. Agent ATO never changes them.</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
