import fs from 'fs/promises';
import path from 'path';

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Write a file so a reader sees the old content or the new, never half of
 * either: write a sibling temp file, then rename over the target. The app's
 * file watcher fires on these writes, and a torn read there would show a task
 * with no frontmatter.
 */
export async function writeFileAtomic(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    await fs.writeFile(temp, content);
    await fs.rename(temp, file);
  } catch (error) {
    await fs.rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * The canonical form of a path for comparisons. Git reports real paths, and
 * on macOS the temp directory alone is /var on one side and /private/var on
 * the other.
 */
export async function realpathOr(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    return path.resolve(target);
  }
}

/** Whether `child` is `parent` or lies inside it. Both must already be absolute and canonical. */
export function isWithin(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith(path.sep) ? parent : parent + path.sep);
}
