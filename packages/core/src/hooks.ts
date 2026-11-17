import fs from 'fs/promises';
import path from 'path';
import { TaskStatus } from './types';
import { homePaths } from './home';

/**
 * hooks/<status>.md, or hooks/<repo>/<status>.md when a repo is named.
 *
 * Hooks are prose for the agent, printed after a status write: "push and
 * open a PR" arrives from the command the agent had to run anyway.
 */
export function hookPath(home: string, status: TaskStatus, repoName?: string | null): string {
  const hooksDir = homePaths(home).hooksDir;
  return isSafeRepoName(repoName)
    ? path.join(hooksDir, repoName, `${status}.md`)
    : path.join(hooksDir, `${status}.md`);
}

/** A hook's text and the file it came from */
export interface Hook {
  file: string;
  text: string;
}

/**
 * The hook for a transition, with the file it was read from, or null when
 * there is none. A per-repo hook wins over the global one; an empty file
 * counts as no hook.
 */
export async function findHook(home: string, status: TaskStatus, repoName?: string | null): Promise<Hook | null> {
  const candidates = isSafeRepoName(repoName)
    ? [hookPath(home, status, repoName), hookPath(home, status)]
    : [hookPath(home, status)];

  for (const file of candidates) {
    try {
      const text = (await fs.readFile(file, 'utf8')).trim();
      if (text) return { file, text };
    } catch {
      // Missing is the common case
    }
  }
  return null;
}

/** The text for a transition, or null when there is none. See `findHook`. */
export async function readHook(home: string, status: TaskStatus, repoName?: string | null): Promise<string | null> {
  return (await findHook(home, status, repoName))?.text ?? null;
}

/** Repo names come from config.json, so they are not trusted straight into a path */
function isSafeRepoName(name: string | null | undefined): name is string {
  return typeof name === 'string' && /^[A-Za-z0-9._-]+$/.test(name) && name !== '.' && name !== '..';
}
