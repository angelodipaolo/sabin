import fs from 'fs/promises';
import path from 'path';

export interface LockOptions {
  /** Give up acquiring after this long */
  timeoutMs?: number;
  /** Treat an existing lock older than this as abandoned */
  staleMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_STALE_MS = 30000;

/**
 * Run `fn` while holding an exclusive lock on the .sabin directory.
 *
 * Scoped deliberately narrowly: only task ID allocation and status mutations
 * race between worktrees. Notes are written to per-ticket directories and
 * need no coordination.
 *
 * Uses mkdir, which is atomic on every platform we care about, so this needs
 * no dependency.
 */
export async function withLock<T>(
  sabinDir: string,
  fn: () => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  const lockDir = path.join(sabinDir, '.lock');

  const deadline = Date.now() + timeoutMs;
  let delay = 25;

  for (;;) {
    try {
      await fs.mkdir(lockDir);
      break;
    } catch (error: any) {
      if (error.code !== 'EEXIST') throw error;

      if (await isStale(lockDir, staleMs)) {
        await fs.rm(lockDir, { recursive: true, force: true });
        continue;
      }

      if (Date.now() >= deadline) {
        throw new Error(
          `Timed out waiting for the Sabin lock at ${lockDir}. ` +
          `If no other sabin command is running, remove that directory.`,
          { cause: error }
        );
      }

      await sleep(Math.min(delay, 250));
      delay *= 2;
    }
  }

  try {
    await fs.writeFile(
      path.join(lockDir, 'owner'),
      JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() })
    );
  } catch {
    // Ownership metadata is advisory only
  }

  try {
    return await fn();
  } finally {
    try {
      await fs.rm(lockDir, { recursive: true, force: true });
    } catch {
      // Releasing is best effort - a leftover lock is broken as stale
    }
  }
}

async function isStale(lockDir: string, staleMs: number): Promise<boolean> {
  try {
    const stat = await fs.stat(lockDir);
    return Date.now() - stat.mtimeMs > staleMs;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
