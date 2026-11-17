import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assertRealPathAllowed, isEditablePath, normalizeNoteName, taskFilePath } from '../src/main/paths';

const home = '/Users/x/sabin';

describe('normalizeNoteName', () => {
  it('adds .md and keeps a plain name', () => {
    expect(normalizeNoteName('research')).toBe('research.md');
    expect(normalizeNoteName(' notes.MD ')).toBe('notes.md');
  });
  it('refuses separators, dots and empties', () => {
    for (const bad of ['', '   ', '../x', 'a/b', 'a\\b', '.hidden', 'a:b', '.md', 'x\u0000']) {
      expect(() => normalizeNoteName(bad), bad).toThrow();
    }
  });
});

describe('isEditablePath', () => {
  it('allows markdown directly in a task directory or projects/', () => {
    expect(isEditablePath(home, `${home}/tasks/SABIN-1/plan.md`)).toBe(true);
    expect(isEditablePath(home, `${home}/projects/billing.md`)).toBe(true);
  });
  it('refuses everything else', () => {
    for (const bad of [
      `${home}/config.json`,
      `${home}/tasks/SABIN-1/sub/plan.md`,
      `${home}/tasks/not-an-id/plan.md`,
      `${home}/tasks/SABIN-1/../../config.md`,
      `${home}/state/sessions/x.md`,
      `${home}/tasks/SABIN-1/plan.txt`,
      `${home}/projects/Bad Name.md`,
      'relative/tasks/SABIN-1/plan.md',
      '/etc/passwd.md'
    ]) {
      expect(isEditablePath(home, bad), bad).toBe(false);
    }
  });
});

describe('taskFilePath', () => {
  it('builds a path from an ID and a name', () => {
    expect(taskFilePath(home, 'sabin-1', 'plan.md')).toBe(path.join(home, 'tasks', 'SABIN-1', 'plan.md'));
  });
  it('refuses bad IDs and names', () => {
    expect(() => taskFilePath(home, '../x', 'plan.md')).toThrow();
    expect(() => taskFilePath(home, 'SABIN-1', '../../config.json')).toThrow();
    expect(() => taskFilePath(home, 'SABIN-1', 'plan')).toThrow();
  });
});

describe('assertRealPathAllowed', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-app-paths-')));
    await fs.mkdir(path.join(root, 'home', 'tasks', 'SABIN-1'), { recursive: true });
    await fs.mkdir(path.join(root, 'outside'), { recursive: true });
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('accepts a real file in the task', async () => {
    const file = path.join(root, 'home', 'tasks', 'SABIN-1', 'plan.md');
    await fs.writeFile(file, 'x');
    await expect(assertRealPathAllowed(path.join(root, 'home'), file)).resolves.toBeUndefined();
  });

  it('refuses a symlink that leads out of the home', async () => {
    await fs.writeFile(path.join(root, 'outside', 'secret.md'), 'x');
    const link = path.join(root, 'home', 'tasks', 'SABIN-1', 'note.md');
    await fs.symlink(path.join(root, 'outside', 'secret.md'), link);
    await expect(assertRealPathAllowed(path.join(root, 'home'), link)).rejects.toThrow();
  });

  it('refuses a task directory that is a symlink elsewhere', async () => {
    await fs.symlink(path.join(root, 'outside'), path.join(root, 'home', 'tasks', 'SABIN-2'));
    await expect(assertRealPathAllowed(path.join(root, 'home'), path.join(root, 'home', 'tasks', 'SABIN-2', 'new.md'))).rejects.toThrow();
  });
});
