import fs from 'fs/promises';
import path from 'path';
import { findTask } from '@sabin/core';
import { newTask } from '../commands/new';
import { work } from '../commands/work';
import { status } from '../commands/status';
import { sandbox, makeRepo, Sandbox } from './helpers';

let box: Sandbox;
let repo: string;
let tree: string;

beforeEach(async () => {
  box = await sandbox();
  repo = await makeRepo(box.root, 'shop');
  await newTask('Fix checkout');
  await box.inDir(repo, () => work('TASK-0001'));
  tree = path.join(box.root, 'shop-worktrees', 'TASK-0001-fix-checkout');

  await fs.mkdir(path.join(box.home, 'hooks', 'shop'), { recursive: true });
  await fs.writeFile(path.join(box.home, 'hooks', 'review.md'), 'Global review hook\n');
  await fs.writeFile(path.join(box.home, 'hooks', 'shop', 'review.md'), 'Push and open a PR for shop\n');
  box.clear();
});
afterEach(async () => { await box.restore(); });

describe('sabin status', () => {
  it('writes the status given an ID and prints the global hook outside a repo', async () => {
    await box.inDir(box.root, () => status('task-0001', 'review'));

    expect((await findTask(box.home, 'TASK-0001'))?.status).toBe('review');
    const out = box.out();
    expect(out).toContain('TASK-0001  open → review  Fix checkout');
    expect(out).toContain(`Hook:      ${path.join(box.home, 'hooks', 'review.md')}`);
    expect(out).toContain('Global review hook');
    expect(out).not.toContain('for shop');
  });

  it('infers the task from the worktree and prefers the per-repo hook there', async () => {
    await box.inDir(tree, () => status('review'));

    expect((await findTask(box.home, 'TASK-0001'))?.status).toBe('review');
    expect(box.out()).toContain('Push and open a PR for shop');
    expect(box.out()).not.toContain('Global review hook');
  });

  it('says when there is no hook and when nothing changed', async () => {
    await box.inDir(tree, () => status('open'));
    expect(box.out()).toContain('open (unchanged)');
    expect(box.out()).toContain('Hook:      none for open');
  });

  it('rejects unknown statuses and tasks with the valid values', async () => {
    await expect(status('TASK-0001', 'done')).rejects.toThrow(
      'Unknown status "done". Valid statuses: open, ready, in_progress, review, completed'
    );
    await expect(status('TASK-0001')).rejects.toThrow('Missing status. Usage: sabin status <id> <status>');
    await expect(status('TASK-0042', 'ready')).rejects.toThrow('Task not found: TASK-0042');
    await expect(status('../x', 'ready')).rejects.toThrow('Invalid task ID');
    await expect(box.inDir(repo, () => status('ready'))).rejects.toThrow("is not inside a task's worktree");
    expect((await findTask(box.home, 'TASK-0001'))?.status).toBe('open');
  });
});
