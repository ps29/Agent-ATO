import { appendFileSync, closeSync, mkdirSync, openSync, readSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';

const CHUNK = 1 << 20;

/**
 * Lossless, append-only copy of every transcript, kept outside ~/.claude so it survives Claude Code's
 * own cleanup of old sessions. Each transcript becomes `<archive>/<project>/<session>.jsonl.gz`,
 * written as concatenated gzip members, so `gunzip` restores the exact original bytes.
 * How many bytes of each file are already copied is kept in the `kv` table.
 */
export class Archive {
  private readonly get;
  private readonly put;

  constructor(
    readonly dir: string,
    db: DatabaseSync,
  ) {
    this.get = db.prepare('SELECT v FROM kv WHERE k = ?');
    this.put = db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
  }

  private offset(rel: string): number {
    const r = this.get.get(`archive:${rel}`) as { v: string } | undefined;
    return r ? Number(r.v) : 0;
  }

  /** Copy any bytes of `path` not yet archived. Returns how many were added. */
  catchUp(path: string, rel: string): number {
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      return 0; // transcript already deleted: the archive keeps what it has
    }
    const file = join(this.dir, `${rel}.gz`);
    let done = this.offset(rel);
    if (size < done) {
      // The transcript was replaced by a shorter one. Keep the old copy and start a new generation.
      renameSync(file, file.replace(/\.gz$/, `.${Date.now()}.gz`));
      done = 0;
      this.put.run(`archive:${rel}`, '0');
    }
    if (size === done) return 0;

    mkdirSync(dirname(file), { recursive: true });
    const fd = openSync(path, 'r');
    const buf = Buffer.allocUnsafe(CHUNK);
    let added = 0;
    try {
      while (done < size) {
        const n = readSync(fd, buf, 0, Math.min(CHUNK, size - done), done);
        if (n <= 0) break;
        appendFileSync(file, gzipSync(buf.subarray(0, n)));
        done += n;
        added += n;
        this.put.run(`archive:${rel}`, String(done));
      }
    } finally {
      closeSync(fd);
    }
    return added;
  }
}
