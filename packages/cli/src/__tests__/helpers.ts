import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/** Run git with an identity and no signing, whatever the machine's config says */
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

export interface Sandbox {
  root: string;
  home: string;
  userHome: string;
  claudeDir: string;
  codexHome: string;
  /** Captured console.log output */
  out(): string;
  /** Captured console.error output */
  err(): string;
  /** Everything written to process.stdout directly */
  raw(): string;
  /** Run `fn` with the cwd at `dir` */
  inDir<T>(dir: string, fn: () => Promise<T>): Promise<T>;
  clear(): void;
  restore(): Promise<void>;
}

/**
 * A fresh, fully temporary world: SABIN_HOME, HOME, CLAUDE_CONFIG_DIR and
 * CODEX_HOME all inside one temp directory, and console output captured.
 */
export async function sandbox(): Promise<Sandbox> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-cli-')));
  const saved = {
    HOME: process.env.HOME,
    SABIN_HOME: process.env.SABIN_HOME,
    CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
    CODEX_HOME: process.env.CODEX_HOME
  };
  const userHome = path.join(root, 'user');
  await fs.mkdir(userHome);
  const env = {
    HOME: userHome,
    SABIN_HOME: path.join(root, 'sabin'),
    CLAUDE_CONFIG_DIR: path.join(userHome, '.claude'),
    CODEX_HOME: path.join(userHome, '.codex')
  };
  Object.assign(process.env, env);

  const cwd = process.cwd();
  const exitCode = process.exitCode;
  let logs: string[] = [];
  let errors: string[] = [];
  let writes: string[] = [];
  const log = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => { logs.push(args.join(' ')); });
  const error = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { errors.push(args.join(' ')); });
  const write = jest.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
    writes.push(String(chunk));
    return true;
  }) as never);

  return {
    root,
    home: env.SABIN_HOME,
    userHome,
    claudeDir: env.CLAUDE_CONFIG_DIR,
    codexHome: env.CODEX_HOME,
    out: () => logs.join('\n'),
    err: () => errors.join('\n'),
    raw: () => writes.join(''),
    async inDir(dir, fn) {
      const previous = process.cwd();
      process.chdir(dir);
      try {
        return await fn();
      } finally {
        process.chdir(previous);
      }
    },
    clear() {
      logs = [];
      errors = [];
      writes = [];
    },
    async restore() {
      log.mockRestore();
      error.mockRestore();
      write.mockRestore();
      process.chdir(cwd);
      process.exitCode = exitCode;
      Object.assign(process.env, saved);
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}
