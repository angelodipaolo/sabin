import fs from 'fs/promises';
import path from 'path';
import { isGitRepo, git } from './git';

/**
 * Ignore the .sabin link locally, without touching a shared .gitignore that
 * other contributors would see.
 */
export async function addGitExclude(projectRoot: string): Promise<boolean> {
  try {
    if (!(await isGitRepo(projectRoot))) return false;

    const commonDir = path.resolve(projectRoot, await git(['rev-parse', '--git-common-dir'], projectRoot));
    const excludePath = path.join(commonDir, 'info', 'exclude');

    let current = '';
    try {
      current = await fs.readFile(excludePath, 'utf8');
    } catch {
      await fs.mkdir(path.dirname(excludePath), { recursive: true });
    }

    if (/^\.sabin$/m.test(current)) return true;

    const separator = current && !current.endsWith('\n') ? '\n' : '';
    await fs.writeFile(excludePath, `${current}${separator}.sabin\n`);
    return true;
  } catch {
    return false;
  }
}
