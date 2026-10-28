import { useEffect, useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';

export function Memory() {
  const sessions = useStore((s) => s.sessions);
  const selectedId = useStore((s) => s.selectedId);
  const project = sessions.find((s) => s.id === selectedId)?.project;
  const [files, setFiles] = useState<{ name: string; content: string }[]>([]);

  useEffect(() => {
    if (!project) return;
    api.memory(project).then((r) => setFiles(r.files)).catch(() => setFiles([]));
  }, [project]);

  if (!project) return <div className="muted">Select a session to see its project memory.</div>;
  return (
    <>
      <div className="muted">Memory files for {project} (read only)</div>
      {files.map((f) => (<div key={f.name} className="card"><b>{f.name}</b><pre>{f.content}</pre></div>))}
      {!files.length && <div className="muted">This project has no memory files.</div>}
    </>
  );
}
