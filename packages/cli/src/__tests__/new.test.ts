import fs from 'fs/promises';
import path from 'path';
import { findTask } from '@sabin/core';
import { newTask } from '../commands/new';
import { sandbox, Sandbox } from './helpers';

let box: Sandbox;
beforeEach(async () => { box = await sandbox(); });
afterEach(async () => { await box.restore(); });

describe('sabin new', () => {
  it('creates the task directory, task.md and prompt.md, and says there is no worktree', async () => {
    await newTask('Update the telemetry', { content: 'Body text' });

    const task = await findTask(box.home, 'TASK-0001');
    expect(task?.title).toBe('Update the telemetry');
    expect(task?.status).toBe('open');
    expect(task?.content.trim()).toBe('Body text');
    expect(await fs.readFile(task!.promptFile, 'utf8')).toContain('TASK-0001');

    const out = box.out();
    expect(out).toContain('Created TASK-0001  Update the telemetry');
    expect(out).toContain(path.join(box.home, 'tasks', 'TASK-0001'));
    expect(out).toContain('No worktree yet. Create one with: sabin work TASK-0001');
  });

  it('takes an external ID and a project', async () => {
    await newTask('Partition the events table', { id: 'arch-1234', project: 'Analytics' });

    const task = await findTask(box.home, 'ARCH-1234');
    expect(task?.project).toBe('analytics');
    expect(box.out()).toContain('Created ARCH-1234');
    expect(box.out()).toContain('analytics');
  });

  it('refuses an ID that is not one, and creates nothing', async () => {
    await expect(newTask('Escape', { id: '../x' })).rejects.toThrow('Invalid task ID: "../x"');
    await expect(fs.readdir(path.join(box.home, 'tasks')).catch(() => [])).resolves.toEqual([]);
    await expect(fs.access(path.join(box.home, 'x'))).rejects.toThrow();
  });

  it('refuses an empty title and a duplicate ID', async () => {
    await expect(newTask('  ')).rejects.toThrow('A title is required');
    await newTask('One', { id: 'JIRA-1' });
    await expect(newTask('Two', { id: 'JIRA-1' })).rejects.toThrow('Task already exists: JIRA-1');
  });

  it('prints stable JSON with --json, and no prompt path', async () => {
    await newTask('Json please', { json: true, project: 'web' });
    const result = JSON.parse(box.out());
    expect(Object.keys(result)).toEqual(['id', 'title', 'status', 'project', 'created', 'taskDir', 'taskFile']);
    expect(result).toMatchObject({ id: 'TASK-0001', status: 'open', project: 'web' });
    expect(result.taskFile).toBe(path.join(box.home, 'tasks', 'TASK-0001', 'task.md'));
    expect(box.out()).not.toContain('prompt.md');
  });
});
