import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  createTask,
  findTask,
  findTaskFile,
  listTasks,
  nextTaskId,
  setTaskStatus,
  readHook,
  hookPath,
  compareTasks
} from '../tasks';
import { parseTask } from '../markdown';
import { SabinConfig, Task } from '../types';

const config: SabinConfig = { projectPrefix: 'SABIN', taskNumberPadding: 4 };

describe('tasks', () => {
  let sabinDir: string;

  beforeEach(async () => {
    sabinDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-tasks-'));
  });

  afterEach(async () => {
    await fs.rm(sabinDir, { recursive: true, force: true });
  });

  describe('createTask', () => {
    it('allocates the next ID and writes to tasks/open', async () => {
      const task = await createTask(sabinDir, config, { title: 'First' });

      expect(task.id).toBe('SABIN-0001');
      expect(task.status).toBe('open');
      expect(task.path).toBe(path.join(sabinDir, 'tasks', 'open', 'SABIN-0001.md'));

      const written = await parseTask(task.path);
      expect(written.title).toBe('First');
      expect(written.status).toBe('open');
    });

    it('counts completed tasks when allocating', async () => {
      await createTask(sabinDir, config, { title: 'One' });
      await createTask(sabinDir, config, { title: 'Two' });
      await setTaskStatus(sabinDir, 'SABIN-0002', 'completed');

      const third = await createTask(sabinDir, config, { title: 'Three' });
      expect(third.id).toBe('SABIN-0003');
    });

    it('accepts an explicit external ID without advancing the sequence', async () => {
      const jira = await createTask(sabinDir, config, { title: 'External', id: 'JIRA-12345' });
      expect(jira.id).toBe('JIRA-12345');

      const own = await createTask(sabinDir, config, { title: 'Own' });
      expect(own.id).toBe('SABIN-0001');
    });

    it('refuses a duplicate ID wherever the existing file lives', async () => {
      await createTask(sabinDir, config, { title: 'One', id: 'JIRA-1' });
      await setTaskStatus(sabinDir, 'JIRA-1', 'completed');

      await expect(createTask(sabinDir, config, { title: 'Again', id: 'JIRA-1' }))
        .rejects.toThrow('Task already exists: JIRA-1');
    });

    it('records the slug and content', async () => {
      const task = await createTask(sabinDir, config, {
        title: 'Update telemetry',
        content: 'Body',
        slug: 'update-telemetry'
      });

      const written = await parseTask(task.path);
      expect(written.slug).toBe('update-telemetry');
      expect(written.content.trim()).toBe('Body');
    });

    it('quotes titles with YAML-significant characters', async () => {
      const task = await createTask(sabinDir, config, { title: 'Fix: the "thing" [now]' });
      expect((await parseTask(task.path)).title).toBe('Fix: the "thing" [now]');
    });
  });

  describe('nextTaskId', () => {
    it('starts at 0001 in an empty project', async () => {
      expect(await nextTaskId(sabinDir, config)).toBe('SABIN-0001');
    });

    it('skips gaps rather than filling them', async () => {
      await createTask(sabinDir, config, { title: 'a', id: 'SABIN-0001' });
      await createTask(sabinDir, config, { title: 'b', id: 'SABIN-0010' });
      expect(await nextTaskId(sabinDir, config)).toBe('SABIN-0011');
    });

    it('grows past the padding width', async () => {
      await createTask(sabinDir, config, { title: 'a', id: 'SABIN-9999' });
      expect(await nextTaskId(sabinDir, config)).toBe('SABIN-10000');
    });
  });

  describe('setTaskStatus', () => {
    it('moves the file to completed and back', async () => {
      const task = await createTask(sabinDir, config, { title: 'Move me' });

      const completed = await setTaskStatus(sabinDir, task.id, 'completed');
      expect(completed.path).toBe(path.join(sabinDir, 'tasks', 'completed', 'SABIN-0001.md'));
      expect(await findTaskFile(sabinDir, task.id)).toBe(completed.path);
      await expect(fs.access(task.path)).rejects.toThrow();
      expect((await parseTask(completed.path)).status).toBe('completed');

      const reopened = await setTaskStatus(sabinDir, task.id, 'review');
      expect(reopened.path).toBe(task.path);
      expect((await parseTask(task.path)).status).toBe('review');
    });

    it('updates in place for statuses that share a directory', async () => {
      const task = await createTask(sabinDir, config, { title: 'Stay' });
      const ready = await setTaskStatus(sabinDir, task.id, 'ready');
      expect(ready.path).toBe(task.path);
    });

    it('matches the ID exactly, never as a substring', async () => {
      await createTask(sabinDir, config, { title: 'Ten', id: 'SABIN-0010' });
      await expect(setTaskStatus(sabinDir, 'SABIN-001', 'review')).rejects.toThrow('Task not found: SABIN-001');
    });

    it('records branch, worktree and slug when given', async () => {
      const task = await createTask(sabinDir, config, { title: 'Record' });
      await setTaskStatus(sabinDir, task.id, 'in_progress', {
        branch: 'angelo/SABIN-0001-record',
        worktree: '/tmp/wt',
        slug: 'record'
      });

      const written = await parseTask(task.path);
      expect(written.branch).toBe('angelo/SABIN-0001-record');
      expect(written.worktree).toBe('/tmp/wt');
      expect(written.slug).toBe('record');
    });
  });

  describe('listTasks and findTask', () => {
    it('lists across directories in numeric order', async () => {
      await createTask(sabinDir, config, { title: 'b', id: 'SABIN-0010' });
      await createTask(sabinDir, config, { title: 'a', id: 'SABIN-0002' });
      await setTaskStatus(sabinDir, 'SABIN-0002', 'completed');

      const ids = (await listTasks(sabinDir)).map(task => task.id);
      expect(ids).toEqual(['SABIN-0002', 'SABIN-0010']);
    });

    it('skips files that cannot be parsed', async () => {
      await createTask(sabinDir, config, { title: 'ok' });
      await fs.writeFile(path.join(sabinDir, 'tasks', 'open', 'BROKEN-1.md'), '---\nstatus: [\n---\n');

      const ids = (await listTasks(sabinDir)).map(task => task.id);
      expect(ids).toEqual(['SABIN-0001']);
    });

    it('reads legacy "resolved" as completed', async () => {
      const dir = path.join(sabinDir, 'tasks', 'completed');
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'TASK-0001.md'), '---\nstatus: resolved\ntitle: Old\n---\n');

      const task = await findTask(sabinDir, 'TASK-0001');
      expect(task?.status).toBe('completed');
    });

    it('finds a task regardless of ID case', async () => {
      await createTask(sabinDir, config, { title: 'Mixed', id: 'Notion-12' });
      expect((await findTask(sabinDir, 'NOTION-12'))?.id).toBe('Notion-12');
      expect((await findTask(sabinDir, 'notion-12'))?.path).toContain('Notion-12.md');
    });

    it('returns null for an unknown ticket', async () => {
      expect(await findTask(sabinDir, 'SABIN-9999')).toBeNull();
    });
  });

  describe('compareTasks', () => {
    const make = (id: string): Task => ({ id, status: 'open', title: id, content: '', path: '' });

    it('orders numerically within a prefix and alphabetically across', () => {
      const sorted = [make('SABIN-0010'), make('JIRA-2'), make('SABIN-0002'), make('JIRA-10')]
        .sort(compareTasks)
        .map(task => task.id);
      expect(sorted).toEqual(['JIRA-2', 'JIRA-10', 'SABIN-0002', 'SABIN-0010']);
    });
  });

  describe('hooks', () => {
    it('returns null when no hook is written', async () => {
      expect(await readHook(sabinDir, 'completed')).toBeNull();
    });

    it('returns the trimmed hook body', async () => {
      await fs.mkdir(path.dirname(hookPath(sabinDir, 'completed')), { recursive: true });
      await fs.writeFile(hookPath(sabinDir, 'completed'), '\nPush the branch and open a PR.\n\n');
      expect(await readHook(sabinDir, 'completed')).toBe('Push the branch and open a PR.');
    });

    it('treats an empty hook as absent', async () => {
      await fs.mkdir(path.dirname(hookPath(sabinDir, 'review')), { recursive: true });
      await fs.writeFile(hookPath(sabinDir, 'review'), '   \n');
      expect(await readHook(sabinDir, 'review')).toBeNull();
    });
  });
});
