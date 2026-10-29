import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { useMemo, useState } from 'react';

const LANGS = { bash, c, cpp, csharp, css, diff, go, ini, java, javascript, json, markdown, php, powershell, python, ruby, rust, sql, typescript, xml, yaml };
for (const [name, def] of Object.entries(LANGS)) hljs.registerLanguage(name, def);

/** Above this size the text is shown plain: highlighting megabytes would freeze the page. */
const HIGHLIGHT_LIMIT = 60_000;

interface Props {
  code: string;
  language?: string;
  label?: string;
  /** Max height in px before the box scrolls. */
  maxHeight?: number;
}

/** A code or command box with syntax highlighting, a copy button and a wrap toggle. */
export function CodeBox({ code, language = 'plaintext', label, maxHeight = 260 }: Props) {
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);

  // highlight.js escapes the text it returns, so the HTML below contains only its own <span>s.
  const html = useMemo(() => {
    if (code.length > HIGHLIGHT_LIMIT || !hljs.getLanguage(language)) return null;
    return hljs.highlight(code, { language, ignoreIllegals: true }).value;
  }, [code, language]);

  const copy = (): void => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    }, () => undefined);
  };

  return (
    <div className="codebox">
      <div className="codebox-bar">
        <span className="muted">{label ?? language}</span>
        <span className="spacer" />
        <button onClick={() => setWrap(!wrap)} aria-pressed={wrap}>{wrap ? 'No wrap' : 'Wrap'}</button>
        <button onClick={copy}>{copied ? 'Copied' : 'Copy'}</button>
      </div>
      <pre className={`codebox-pre ${wrap ? 'wrap' : ''}`} style={{ maxHeight }} tabIndex={0}>
        {html !== null ? <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} /> : <code>{code}</code>}
      </pre>
    </div>
  );
}
