import fs from 'fs/promises';
import path from 'path';
import {
  createTask,
  findTask,
  getTask,
  listTasks,
  nextTaskId,
  setTaskStatus,
  setTaskBody,
  updateTask
} from '../tasks';
import { listNotes, findPlan, planPath, findLog, logPath, RESERVED_FILENAMES } from '../taskFiles';
import { defaultConfig } from '../config';
import { parseFrontmatter } from '../markdown';
import { SabinConfig } from '../types';
import { tempDir } from './helpers';

const config: SabinConfig = { ...defaultConfig(), idPrefix: 'SABIN', idPadding: 4 };

let home: string;

beforeEach(async () => {
  home = await tempDir('sabin-tasks-');
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe('createTask', () => {
  it('allocates the next ID and writes task.md and prompt.md', async () => {
    const task = await createTask(home, config, { title: 'First', created: '2026-11-16' });

    expect(task.id).toBe('SABIN-0001');
    expect(task.status).toBe('open');
    expect(task.created).toBe('2026-11-16');
    expect(task.dir).toBe(path.join(home, 'tasks', 'SABIN-0001'));
    expect(task.file).toBe(path.join(task.dir, 'task.md'));
    expect(task.promptFile).toBe(path.join(task.dir, 'prompt.md'));

    const { data } = parseFrontmatter(await fs.readFile(task.file, 'utf8'));
    expect(data).toMatchObject({ status: 'open', title: 'First' });
    expect(await fs.readFile(task.promptFile, 'utf8')).toContain('SABIN-0001 - First');
  });

  it('allocates past every existing number, completed tasks included', async () => {
    await createTask(home, config, { title: 'One' });
    await createTask(home, config, { title: 'Two' });
    await setTaskStatus(home, 'SABIN-0002', 'completed');
    expect((await createTask(home, config, { title: 'Three' })).id).toBe('SABIN-0003');
  });

  it('counts a broken task directory when allocating', async () => {
    await fs.mkdir(path.join(home, 'tasks', 'SABIN-0007'), { recursive: true });
    expect(await nextTaskId(home, config)).toBe('SABIN-0008');
  });

  it('allocates project IDs independently and counts broken directories', async () => {
    await fs.mkdir(path.join(home, 'tasks', 'SABINAPP-0007'), { recursive: true });
    expect(await nextTaskId(home, config, 'Sabin App')).toBe('SABINAPP-0008');
    const tasks = await Promise.all(Array.from({ length: 3 }, () => createTask(home, config, { title: 'T', project: 'Sabin App' })));
    expect(tasks.map(task => task.id).sort()).toEqual(['SABINAPP-0008', 'SABINAPP-0009', 'SABINAPP-0010']);
    expect(await nextTaskId(home, config)).toBe('SABIN-0001');
    expect(await nextTaskId(home, config, '123 App')).toBe('P123APP-0001');
    expect((await createTask(home, config, { title: 'External', project: 'Sabin', id: 'ARCH-12' })).id).toBe('ARCH-12');
  });

  it('pads to idPadding', async () => {
    expect(await nextTaskId(home, { ...config, idPadding: 2 })).toBe('SABIN-01');
  });

  it('refuses an invalid idPrefix rather than inventing one', async () => {
    await expect(nextTaskId(home, { ...config, idPrefix: 'my_proj' })).rejects.toThrow('Invalid idPrefix');
  });

  it('takes an external ID, uppercased, without advancing the sequence', async () => {
    const external = await createTask(home, config, { title: 'External', id: 'arch-1234' });
    expect(external.id).toBe('ARCH-1234');
    expect((await createTask(home, config, { title: 'Own' })).id).toBe('SABIN-0001');
  });

  it.each(['../x', '../../etc/passwd', 'SABIN-1/../../x', 'nope'])('refuses the ID %j', async id => {
    await expect(createTask(home, config, { title: 'Bad', id })).rejects.toMatchObject({ code: 'INVALID_TASK_ID' });
    expect(await fs.readdir(home)).not.toContain('x');
  });

  it('refuses an ID that already exists', async () => {
    await createTask(home, config, { title: 'One', id: 'ARCH-1' });
    await expect(createTask(home, config, { title: 'Two', id: 'arch-1' })).rejects.toMatchObject({ code: 'TASK_EXISTS' });
  });

  it('normalises the project and writes the body', async () => {
    const task = await createTask(home, config, { title: 'T', project: 'Sabin App', content: 'Body text\n' });
    expect(task.project).toBe('sabin-app');
    expect(task.content.trim()).toBe('Body text');
  });

  it('never hands out one number twice under concurrency', async () => {
    const tasks = await Promise.all(Array.from({ length: 6 }, (_, n) => createTask(home, config, { title: `T${n}` })));
    expect(new Set(tasks.map(task => task.id)).size).toBe(6);
  });
});

describe('findTask', () => {
  it('finds case-insensitively', async () => {
    await createTask(home, config, { title: 'One' });
    expect((await findTask(home, 'sabin-0001'))?.title).toBe('One');
  });

  it('returns null for a missing task and throws for a non-ID', async () => {
    expect(await findTask(home, 'SABIN-0099')).toBeNull();
    await expect(findTask(home, '../x')).rejects.toMatchObject({ code: 'INVALID_TASK_ID' });
    await expect(getTask(home, 'SABIN-0099')).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
  });
});

describe('listTasks', () => {
  it('sorts numerically', async () => {
    for (const id of ['SABIN-10', 'SABIN-2', 'ARCH-5']) await createTask(home, config, { title: id, id });
    expect((await listTasks(home)).map(task => task.id)).toEqual(['ARCH-5', 'SABIN-2', 'SABIN-10']);
  });

  it('skips what it cannot read instead of failing', async () => {
    await createTask(home, config, { title: 'Good' });
    const tasks = path.join(home, 'tasks');
    // No task.md
    await fs.mkdir(path.join(tasks, 'SABIN-0050'));
    // Unparsable frontmatter
    await fs.mkdir(path.join(tasks, 'SABIN-0051'));
    await fs.writeFile(path.join(tasks, 'SABIN-0051', 'task.md'), '---\ntitle: [unclosed\n---\n');
    // Not an ID, and a stray file
    await fs.mkdir(path.join(tasks, 'notes'));
    await fs.writeFile(path.join(tasks, 'README.md'), 'hi');

    expect((await listTasks(home)).map(task => task.id)).toEqual(['SABIN-0001']);
  });

  it('reads an unknown status as open and a YAML date as an ISO date', async () => {
    await fs.mkdir(path.join(home, 'tasks', 'SABIN-0003'), { recursive: true });
    await fs.writeFile(path.join(home, 'tasks', 'SABIN-0003', 'task.md'), '---\nstatus: resolved\ncreated: 2026-01-02\n---\n');
    const [task] = await listTasks(home);
    expect(task.status).toBe('open');
    expect(task.title).toBe('SABIN-0003');
    expect(task.created).toBe('2026-01-02');
  });

  it('is empty before the home exists', async () => {
    expect(await listTasks(path.join(home, 'missing'))).toEqual([]);
  });
});

describe('setTaskStatus', () => {
  it('rewrites the status in place, keeping the body and unknown keys', async () => {
    const task = await createTask(home, config, { title: 'One', content: 'Keep me\n' });
    await fs.writeFile(task.file, (await fs.readFile(task.file, 'utf8')).replace('title:', 'custom: yes\ntitle:'));

    const updated = await setTaskStatus(home, 'sabin-0001', 'in_progress');

    expect(updated.status).toBe('in_progress');
    expect(updated.file).toBe(task.file);
    const { data, content } = parseFrontmatter(await fs.readFile(task.file, 'utf8'));
    expect(data).toMatchObject({ status: 'in_progress', title: 'One', custom: 'yes' });
    expect(content.trim()).toBe('Keep me');
  });

  it('leaves no temp files and no lock behind', async () => {
    const task = await createTask(home, config, { title: 'One' });
    await Promise.all(['ready', 'review', 'completed'].map(status => setTaskStatus(home, task.id, status)));
    expect((await fs.readdir(task.dir)).sort()).toEqual(['prompt.md', 'task.md']);
    expect(await fs.readdir(home)).not.toContain('.lock');
    expect(['ready', 'review', 'completed']).toContain((await getTask(home, task.id)).status);
  });

  it('rejects an invalid status and leaves the file untouched', async () => {
    const task = await createTask(home, config, { title: 'One' });
    const before = await fs.readFile(task.file, 'utf8');
    await expect(setTaskStatus(home, task.id, 'resolved')).rejects.toMatchObject({ code: 'INVALID_STATUS' });
    expect(await fs.readFile(task.file, 'utf8')).toBe(before);
  });

  it('rejects a missing task and a bad ID', async () => {
    await expect(setTaskStatus(home, 'SABIN-0404', 'ready')).rejects.toMatchObject({ code: 'TASK_NOT_FOUND' });
    await expect(setTaskStatus(home, '../x', 'ready')).rejects.toMatchObject({ code: 'INVALID_TASK_ID' });
  });
});

describe('updateTask', () => {
  it('edits title and project, and removes the project with null', async () => {
    const task = await createTask(home, config, { title: 'Old' });
    expect(await updateTask(home, task.id, { title: 'New', project: 'Core' })).toMatchObject({ title: 'New', project: 'core', status: 'open' });
    expect((await updateTask(home, task.id, { project: null })).project).toBeUndefined();
  });

  it('refuses an unusable project', async () => {
    const task = await createTask(home, config, { title: 'Old' });
    await expect(updateTask(home, task.id, { project: '!!!' })).rejects.toMatchObject({ code: 'INVALID_PROJECT' });
  });
});

describe('task files', () => {
  it('lists every note except the reserved names', async () => {
    const task = await createTask(home, config, { title: 'One' });
    expect(await findPlan(task.dir)).toBeNull();
    expect(await findLog(task.dir)).toBeNull();

    for (const name of ['plan.md', 'log.md', 'review.md', 'a-research.md', 'image.png']) {
      await fs.writeFile(path.join(task.dir, name), 'x');
    }
    await fs.mkdir(path.join(task.dir, 'sub.md'));

    expect(await findPlan(task.dir)).toBe(planPath(task.dir));
    expect(await findLog(task.dir)).toBe(logPath(task.dir));
    expect(await listNotes(task.dir)).toEqual([path.join(task.dir, 'a-research.md'), path.join(task.dir, 'review.md')]);
    expect(RESERVED_FILENAMES).toEqual(['task.md', 'prompt.md', 'plan.md', 'log.md']);
  });
});

describe('setTaskBody', () => {
  it('replaces the body and keeps every frontmatter key', async () => {
    const task = await createTask(home, config, { title: 'Body', project: 'app', content: 'Old body\n' });
    await setTaskStatus(home, task.id, 'review');
    const raw = await fs.readFile(task.file, 'utf8');
    await fs.writeFile(task.file, raw.replace('status: review', 'status: review\nextra: kept'));

    const updated = await setTaskBody(home, task.id, '# New\n\nBody text\n');

    expect(updated.content).toContain('Body text');
    const { data, content } = parseFrontmatter(await fs.readFile(task.file, 'utf8'));
    expect(data).toMatchObject({ status: 'review', title: 'Body', project: 'app', extra: 'kept' });
    expect(content).toContain('# New\n\nBody text');
    expect(content).not.toContain('Old body');
  });

  it('round-trips the body it reads', async () => {
    const task = await createTask(home, config, { title: 'Stable', content: 'Line one\n\nLine two\n' });
    const before = await fs.readFile(task.file, 'utf8');
    await setTaskBody(home, task.id, (await getTask(home, task.id)).content);
    expect(await fs.readFile(task.file, 'utf8')).toBe(before);
  });

  it('throws for a missing task', async () => {
    await expect(setTaskBody(home, 'SABIN-0099', 'x')).rejects.toThrow('Task not found');
  });
});
