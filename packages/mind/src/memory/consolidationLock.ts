// Cross-process consolidation lock (core-redesign critic fix #3).
//
// The daemon AND the garrison both run reflection over the same ~/.ares memory
// file; without a lock two processes can fire consolidate()/synthesize()
// concurrently and the second persist() clobbers the first (each rewrites the
// whole JSONL from its own in-memory map). This is the mtime-style lock the
// redesign calls for: exclusive-create a lock file beside the memory file,
// steal it only when stale, always release.
//
// Semantics: withConsolidationLock() runs `fn` iff the lock is acquired and
// returns its result; when another live process holds the lock it returns
// undefined WITHOUT running fn (reflection is periodic — skipping a pass is
// always safe; double-writing is not).

import path from "node:path";
import { promises as fs } from "node:fs";

const DEFAULT_STALE_MS = 5 * 60_000;

export interface ConsolidationLockOptions {
  /** A lock older than this is considered abandoned and stolen. */
  staleMs?: number;
  now?: Date;
}

function lockPath(memoryFile: string): string {
  return path.join(path.dirname(memoryFile), ".consolidation.lock");
}

async function acquire(file: string, staleMs: number, now: Date): Promise<boolean> {
  try {
    await fs.writeFile(file, `${process.pid} ${now.toISOString()}\n`, { flag: "wx" });
    return true;
  } catch {
    // Lock exists — steal it only when stale (holder died mid-reflection).
    try {
      const stat = await fs.stat(file);
      if (now.getTime() - stat.mtimeMs < staleMs) return false;
      await fs.writeFile(file, `${process.pid} ${now.toISOString()}\n`);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Run `fn` under the cross-process consolidation lock for `memoryFile`'s
 * directory. Returns fn's result, or undefined when another process holds a
 * live lock (the pass is skipped, never queued). Errors from fn propagate;
 * the lock is released either way.
 */
export async function withConsolidationLock<T>(
  memoryFile: string,
  fn: () => Promise<T>,
  opts: ConsolidationLockOptions = {},
): Promise<T | undefined> {
  const file = lockPath(memoryFile);
  const now = opts.now ?? new Date();
  await fs.mkdir(path.dirname(file), { recursive: true }).catch(() => undefined);
  if (!(await acquire(file, opts.staleMs ?? DEFAULT_STALE_MS, now))) return undefined;
  try {
    return await fn();
  } finally {
    await fs.unlink(file).catch(() => undefined);
  }
}
