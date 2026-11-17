import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** A fresh temporary directory, as a real path so it compares equal to what git reports */
export async function tempDir(prefix = 'sabin-test-'): Promise<string> {
  return fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)));
}

/** Run git with an identity and no signing, whatever the machine's global config says */
export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(
    'git',
    ['-c', 'user.name=Sabin Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args],
    { cwd }
  );
  return stdout.trim();
}

/** A repo at <parent>/<name> on `main`, with one commit */
export async function makeRepo(parent: string, name: string): Promise<string> {
  const dir = path.join(parent, name);
  await fs.mkdir(dir, { recursive: true });
  await git(dir, 'init', '-q', '-b', 'main');
  await fs.writeFile(path.join(dir, 'README.md'), `# ${name}\n`);
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-q', '-m', 'initial');
  return dir;
}

/** A linked worktree of `repo` on a new branch */
export async function addWorktree(repo: string, dir: string, branch: string): Promise<string> {
  await git(repo, 'worktree', 'add', '-q', '-b', branch, dir);
  return fs.realpath(dir);
}
