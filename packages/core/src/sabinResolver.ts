import fs from 'fs/promises';
import path from 'path';
import { mainWorktreeRoot } from './git';

export interface SabinLinkConfig {
  sabinDir: string;
}

export interface ResolvedSabin {
  sabinDir: string;
  isLinked: boolean;
  projectRoot: string;
}

/**
 * Read a .sabin entry at `projectRoot`, following it if it is a link file.
 * Returns null when nothing is there.
 */
async function readSabinAt(projectRoot: string): Promise<ResolvedSabin | null> {
  const sabinPath = path.join(projectRoot, '.sabin');

  let stat;
  try {
    stat = await fs.stat(sabinPath);
  } catch (error: any) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }

  if (stat.isDirectory()) {
    return { sabinDir: sabinPath, isLinked: false, projectRoot };
  }

  if (stat.isFile()) {
    const content = await fs.readFile(sabinPath, 'utf8');
    const config: SabinLinkConfig = JSON.parse(content);

    if (!config.sabinDir) {
      throw new Error('.sabin file must contain "sabinDir" field');
    }

    return {
      sabinDir: path.resolve(projectRoot, config.sabinDir),
      isLinked: true,
      projectRoot
    };
  }

  throw new Error('.sabin exists but is neither a file nor directory');
}

/**
 * Resolve the actual .sabin directory path.
 *
 * Looks in `startDir`, then walks up, then falls back to the main worktree
 * root - so a worktree with no .sabin link file of its own still resolves.
 * Handles both the directory and link-file forms.
 */
export async function resolveSabinDir(startDir: string = process.cwd()): Promise<ResolvedSabin> {
  let dir = path.resolve(startDir);

  for (;;) {
    const found = await readSabinAt(dir);
    if (found) return found;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const mainRoot = await mainWorktreeRoot(path.resolve(startDir));
  if (mainRoot) {
    const found = await readSabinAt(mainRoot);
    if (found) return found;
  }

  throw new Error('.sabin not found. Run "sabin init" first.');
}

/**
 * Write .sabin link file
 */
export async function writeSabinLink(projectRoot: string, targetSabinDir: string): Promise<void> {
  const sabinPath = path.join(projectRoot, '.sabin');

  // Calculate relative path from project to target .sabin
  const relativePath = path.relative(projectRoot, targetSabinDir);

  const config: SabinLinkConfig = {
    sabinDir: relativePath
  };

  const content = JSON.stringify(config, null, 2);
  await fs.writeFile(sabinPath, content);
}

/**
 * Check if .sabin exists and whether it's a file or directory
 */
export async function checkSabinType(projectRoot: string): Promise<'file' | 'directory' | 'none'> {
  const sabinPath = path.join(projectRoot, '.sabin');

  try {
    const stat = await fs.stat(sabinPath);
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
    return 'none';
  } catch {
    return 'none';
  }
}
