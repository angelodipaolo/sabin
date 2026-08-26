import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

export interface WorktreeInfo {
  path: string;
  head?: string;
  branch?: string;
  detached: boolean;
  bare: boolean;
}

/**
 * Run a git command, returning trimmed stdout
 */
export async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await git(['rev-parse', '--git-dir'], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Current branch name, or null when HEAD is detached
 */
export async function currentBranch(cwd: string): Promise<string | null> {
  try {
    const branch = await git(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd);
    return branch || null;
  } catch {
    return null;
  }
}

/**
 * Root of the main worktree, even when called from a linked worktree.
 *
 * The common git dir is shared by every worktree, so its parent is always
 * the main checkout.
 */
export async function mainWorktreeRoot(cwd: string): Promise<string | null> {
  try {
    const commonDir = path.resolve(cwd, await git(['rev-parse', '--git-common-dir'], cwd));
    if (path.basename(commonDir) === '.git') {
      return path.dirname(commonDir);
    }
    // Bare repo - no main checkout to speak of
    return null;
  } catch {
    return null;
  }
}

/**
 * Toplevel of the worktree we are currently standing in
 */
export async function repoRoot(cwd: string): Promise<string | null> {
  try {
    return await git(['rev-parse', '--show-toplevel'], cwd);
  } catch {
    return null;
  }
}

/**
 * Parse `git worktree list --porcelain` into structured records
 */
export async function listWorktrees(cwd: string): Promise<WorktreeInfo[]> {
  let output: string;
  try {
    output = await git(['worktree', 'list', '--porcelain'], cwd);
  } catch {
    return [];
  }

  const worktrees: WorktreeInfo[] = [];
  let current: WorktreeInfo | null = null;

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: line.slice('worktree '.length), detached: false, bare: false };
    } else if (!current) {
      continue;
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      // Comes through as refs/heads/<name>
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === 'detached') {
      current.detached = true;
    } else if (line === 'bare') {
      current.bare = true;
    }
  }
  if (current) worktrees.push(current);

  return worktrees;
}

export async function branchExists(cwd: string, branch: string): Promise<boolean> {
  try {
    await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], cwd);
    return true;
  } catch {
    return false;
  }
}

/**
 * Add a worktree, creating the branch unless it already exists
 */
export async function addWorktree(cwd: string, worktreePath: string, branch: string): Promise<void> {
  const exists = await branchExists(cwd, branch);
  const args = exists
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', '-b', branch, worktreePath];
  await git(args, cwd);
}

