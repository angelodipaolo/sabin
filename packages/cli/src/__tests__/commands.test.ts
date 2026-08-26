import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { parseTask, findTask } from '@sabin/core';
import { createTask } from '../commands/create-task';
import { updateStatus } from '../commands/update-status';
import { listTasks } from '../commands/list-tasks';
import { startTask } from '../commands/start';

jest.mock('chalk', () => {
  const identity = (text: string) => text;
  return {
    green: identity, red: identity, yellow: identity, blue: identity,
    magenta: identity, gray: identity, cyan: identity, bold: identity, white: identity
  };
});

// Every command resolves the Sabin directory through core; point it at a
// temporary one so the tests run against a real filesystem.
let sabinDir = '';
let projectRoot = '';

jest.mock('@sabin/core', () => {
  const actual = jest.requireActual('@sabin/core');
  return {
    ...actual,
    resolveSabinDir: jest.fn(async () => ({ sabinDir, isLinked: true, projectRoot }))
  };
});

const CONFIG = { projectPrefix: 'SABIN', taskNumberPadding: 4, branch: { prefix: 'me' } };

function logged(spy: jest.SpyInstance): string {
  return spy.mock.calls.map(call => call.join(' ')).join('\n');
}

describe('CLI commands', () => {
  let log: jest.SpyInstance;
  let error: jest.SpyInstance;

  beforeEach(async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-cli-'));
    sabinDir = path.join(root, '.sabin');
    projectRoot = path.join(root, 'repo');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(sabinDir, { recursive: true });
    await fs.writeFile(path.join(sabinDir, 'config.json'), JSON.stringify(CONFIG));

    log = jest.spyOn(console, 'log').mockImplementation();
    error = jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`Process exit ${code}`);
    }) as never);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(path.dirname(sabinDir), { recursive: true, force: true });
  });

  describe('task create', () => {
    it('creates the task, its notes directory and prompt scratchpad', async () => {
      await createTask('Update telemetry', { content: 'Body' });

      const task = await findTask(sabinDir, 'SABIN-0001');
      expect(task?.title).toBe('Update telemetry');
      expect(task?.content.trim()).toBe('Body');

      const notesDir = path.join(sabinDir, 'notes', 'SABIN-0001-update-telemetry');
      expect((await fs.stat(notesDir)).isDirectory()).toBe(true);
      const prompt = await fs.readFile(path.join(sabinDir, 'prompts', 'SABIN-0001-update-telemetry.md'), 'utf8');
      expect(prompt).toContain('SABIN-0001-update-telemetry - Update telemetry');

      // The bare ID is the last thing on stdout, so it can be piped
      expect(log.mock.calls.at(-1)?.[0]).toBe('SABIN-0001');
    });

    it('accepts the title via --title and an explicit ID', async () => {
      await createTask(undefined, { title: 'Fix bug', number: 'JIRA-12345' });
      expect(await findTask(sabinDir, 'JIRA-12345')).not.toBeNull();
      expect(await findTask(sabinDir, 'SABIN-0001')).toBeNull();
    });

    it('requires a title', async () => {
      await expect(createTask(undefined, {})).rejects.toThrow('Process exit 1');
      expect(logged(error)).toContain('A title is required');
    });

    it('refuses a duplicate ID', async () => {
      await createTask('One', { number: 'JIRA-1' });
      await expect(createTask('Again', { number: 'JIRA-1' })).rejects.toThrow('Process exit 1');
      expect(logged(error)).toContain('Task already exists: JIRA-1');
    });

    it('prints JSON with --json', async () => {
      await createTask('Json please', { json: true });
      const output = JSON.parse(logged(log));
      expect(output.ticket).toBe('SABIN-0001');
      expect(output.notesDir).toBe(path.join(sabinDir, 'notes', 'SABIN-0001-json-please'));
    });
  });

  describe('task update', () => {
    it('moves a task to completed and back', async () => {
      await createTask('Move', {});

      await updateStatus('SABIN-0001', 'completed');
      const done = await findTask(sabinDir, 'SABIN-0001');
      expect(done?.status).toBe('completed');
      expect(done?.path).toBe(path.join(sabinDir, 'tasks', 'completed', 'SABIN-0001.md'));

      await updateStatus('sabin-0001', 'review');
      const reopened = await findTask(sabinDir, 'SABIN-0001');
      expect(reopened?.status).toBe('review');
      expect(reopened?.path).toBe(path.join(sabinDir, 'tasks', 'open', 'SABIN-0001.md'));
    });

    it('rejects an invalid status', async () => {
      await expect(updateStatus('SABIN-0001', 'done')).rejects.toThrow('Process exit 1');
      expect(logged(error)).toContain('Invalid status: done');
    });

    it('fails for an unknown task', async () => {
      await expect(updateStatus('SABIN-0009', 'ready')).rejects.toThrow('Process exit 1');
      expect(logged(error)).toContain('Task not found: SABIN-0009');
    });

    it('prints the project hook for the new status', async () => {
      await createTask('Hooked', {});
      await fs.mkdir(path.join(sabinDir, 'hooks'), { recursive: true });
      await fs.writeFile(path.join(sabinDir, 'hooks', 'completed.md'), 'Push and open a PR.\n');

      await updateStatus('SABIN-0001', 'completed');
      expect(logged(log)).toContain('Push and open a PR.');

      log.mockClear();
      await updateStatus('SABIN-0001', 'review', { json: true });
      expect(JSON.parse(logged(log)).hook).toBeNull();
    });
  });

  describe('task list', () => {
    beforeEach(async () => {
      await createTask('Open one', {});
      await createTask('Done one', {});
      await updateStatus('SABIN-0002', 'completed');
      log.mockClear();
    });

    it('hides completed tasks by default', async () => {
      await listTasks({});
      const output = logged(log);
      expect(output).toContain('SABIN-0001');
      expect(output).not.toContain('SABIN-0002');
    });

    it('shows everything with --all and filters with --status', async () => {
      await listTasks({ all: true });
      expect(logged(log)).toContain('SABIN-0002');

      log.mockClear();
      await listTasks({ status: 'completed' });
      expect(logged(log)).toContain('SABIN-0002');
      expect(logged(log)).not.toContain('SABIN-0001');
    });

    it('reports plans and emits JSON', async () => {
      await fs.writeFile(path.join(sabinDir, 'notes', 'SABIN-0001-open-one', 'plan.md'), '# Plan');

      await listTasks({ json: true });
      const [task] = JSON.parse(logged(log));
      expect(task.ticket).toBe('SABIN-0001');
      expect(task.plan).toBe(path.join(sabinDir, 'notes', 'SABIN-0001-open-one', 'plan.md'));
    });

    it('rejects an invalid status filter', async () => {
      await expect(listTasks({ status: 'nope' })).rejects.toThrow('Process exit 1');
    });
  });

  describe('start', () => {
    it('creates a task from a suffixed ticket and marks it in_progress', async () => {
      await startTask('SABIN-0007-add-thing', { noWorktree: true });

      const task = await parseTask(path.join(sabinDir, 'tasks', 'open', 'SABIN-0007.md'));
      expect(task.status).toBe('in_progress');
      expect(task.title).toBe('Add thing');
      expect(task.slug).toBe('add-thing');
      expect(task.branch).toBe('me/SABIN-0007-add-thing');
      expect((await fs.stat(path.join(sabinDir, 'notes', 'SABIN-0007-add-thing'))).isDirectory()).toBe(true);
    });

    it('refuses to invent a task from a bare ticket', async () => {
      await expect(startTask('SABIN-0008', { noWorktree: true })).rejects.toThrow('Process exit 1');
      expect(logged(error)).toContain('No task found for SABIN-0008');
    });
  });
});
