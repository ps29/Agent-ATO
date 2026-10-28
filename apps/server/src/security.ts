import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

/** Host headers a local browser can legitimately send. Anything else may be DNS rebinding. */
export function allowedHosts(port: number): Set<string> {
  return new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
}

/** Load the per-install ingest token, creating it on first use. */
export function loadToken(dataDir: string): string {
  const file = join(dataDir, 'token');
  try {
    const t = readFileSync(file, 'utf8').trim();
    if (t) return t;
  } catch {
    /* create below */
  }
  mkdirSync(dataDir, { recursive: true });
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, `${token}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    /* not supported on every platform */
  }
  return token;
}

export function tokenMatches(expected: string, given: unknown): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** True when `target` is inside one of `roots` after resolving `..` segments. */
export function isContained(target: string, roots: string[]): boolean {
  const t = resolve(target);
  return roots.some((r) => {
    const rel = relative(resolve(r), t);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  });
}
