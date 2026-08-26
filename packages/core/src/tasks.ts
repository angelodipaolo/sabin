import fs from 'fs/promises';
import path from 'path';
import { SabinConfig, Task, TaskStatus } from './types';
import { parseTask, writeTask } from './markdown';
import { withLock } from './lock';
import { TaskExistsError, TaskNotFoundError } from './errors';

/**
 * Tasks live in tasks/<dir>/<ID>.md. The directory is the second copy of the
 * status, which is why every status write goes through here: the frontmatter
 * and the location have to change together.
 */
export function tasksDir(sabinDir: string): string {
  return path.join(sabinDir, 'tasks');
}

export function statusDirName(status: TaskStatus): 'open' | 'completed' {
  return status === 'completed' ? 'completed' : 'open';
}

export function taskPathFor(sabinDir: string, id: string, status: TaskStatus): string {
  return path.join(tasksDir(sabinDir), statusDirName(status), `${id}.md`);
}

/**
 * Locate a task file by ID across every tasks/<status> directory.
 *
 * Matches the whole filename, case-insensitively: `sabin-0010` finds
 * SABIN-0010.md, and SABIN-001 never matches SABIN-0010.md.
 */
export async function findTaskFile(sabinDir: string, id: string): Promise<string | null> {
  const root = tasksDir(sabinDir);
  const wanted = `${id}.md`.toLowerCase();

  let dirs: string[];
  try {
    dirs = (await fs.readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return null;
  }

  for (const dir of dirs) {
    let files: string[];
    try {
      files = await fs.readdir(path.join(root, dir));
    } catch {
      continue;
    }
    const match = files.find(file => file.toLowerCase() === wanted);
    if (match) return path.join(root, dir, match);
  }

  return null;
}

export async function findTask(sabinDir: string, id: string): Promise<Task | null> {
  const file = await findTaskFile(sabinDir, id);
  return file ? parseTask(file) : null;
}

/**
 * Every task, whatever directory it sits in. A malformed file is skipped
 * rather than failing the whole listing.
 */
export async function listTasks(sabinDir: string): Promise<Task[]> {
  const root = tasksDir(sabinDir);
  const tasks: Task[] = [];

  let dirs: string[];
  try {
    dirs = (await fs.readdir(root, { withFileTypes: true }))
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return tasks;
  }

  for (const dir of dirs) {
    let files: string[];
    try {
      files = (await fs.readdir(path.join(root, dir))).filter(file => file.endsWith('.md'));
    } catch {
      continue;
    }

    for (const file of files) {
      try {
        tasks.push(await parseTask(path.join(root, dir, file)));
      } catch {
        // Skip what cannot be parsed
      }
    }
  }

  return tasks.sort(compareTasks);
}

/**
 * Sort by numeric suffix, then by ID, so SABIN-0002 precedes SABIN-0010 and
 * external tickets group by their own prefix.
 */
export function compareTasks(a: Task, b: Task): number {
  const [prefixA, numberA] = splitId(a.id);
  const [prefixB, numberB] = splitId(b.id);
  if (prefixA !== prefixB) return prefixA.localeCompare(prefixB);
  return numberA - numberB;
}

function splitId(id: string): [string, number] {
  const match = id.match(/^(.*?)-?(\d+)$/);
  return match ? [match[1], parseInt(match[2], 10)] : [id, 0];
}

/**
 * Next free ID for the project prefix. Only the project's own tickets count -
 * an external JIRA-12345 never advances the sequence.
 */
export async function nextTaskId(sabinDir: string, config: SabinConfig): Promise<string> {
  const pattern = new RegExp(`^${escapeRegex(config.projectPrefix)}-(\\d+)$`, 'i');
  let max = 0;

  for (const task of await listTasks(sabinDir)) {
    const match = task.id.match(pattern);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  }

  return `${config.projectPrefix}-${String(max + 1).padStart(config.taskNumberPadding, '0')}`;
}

export interface CreateTaskOptions {
  title: string;
  content?: string;
  /** Explicit ID such as JIRA-12345; allocated from the sequence when absent */
  id?: string;
  slug?: string;
}

/**
 * Create a task file. Allocation and the write happen under the lock, so two
 * worktrees creating tasks at once cannot claim the same number.
 */
export async function createTask(
  sabinDir: string,
  config: SabinConfig,
  options: CreateTaskOptions
): Promise<Task> {
  return withLock(sabinDir, async () => {
    const id = options.id?.trim() || await nextTaskId(sabinDir, config);

    if (await findTaskFile(sabinDir, id)) {
      throw new TaskExistsError(id);
    }

    const task: Task = {
      id,
      status: 'open',
      title: options.title.trim() || id,
      content: options.content ?? '',
      path: taskPathFor(sabinDir, id, 'open')
    };
    if (options.slug) task.slug = options.slug;

    await writeTask(task);
    return task;
  });
}

export interface StatusPatch {
  branch?: string;
  worktree?: string;
  slug?: string;
}

/**
 * Change a task's status, moving the file between directories when needed.
 *
 * The one place status is written. Returns the task as it now is on disk.
 */
export async function setTaskStatus(
  sabinDir: string,
  id: string,
  status: TaskStatus,
  patch: StatusPatch = {}
): Promise<Task> {
  return withLock(sabinDir, async () => {
    const file = await findTaskFile(sabinDir, id);
    if (!file) throw new TaskNotFoundError(id);

    const task = await parseTask(file);
    const target = taskPathFor(sabinDir, task.id, status);

    task.status = status;
    if (patch.branch) task.branch = patch.branch;
    if (patch.worktree) task.worktree = patch.worktree;
    if (patch.slug) task.slug = patch.slug;
    task.path = target;

    await writeTask(task);
    if (path.resolve(file) !== path.resolve(target)) {
      await fs.unlink(file);
    }

    return task;
  });
}

/**
 * Project instructions for a status transition, at hooks/<status>.md.
 *
 * Printed by `sabin task update` once the change lands, so an agent that
 * moves a task to `completed` is handed "push and open a PR" by the same
 * command - no extra call to remember, nothing to configure in the skill.
 */
export function hookPath(sabinDir: string, status: TaskStatus): string {
  return path.join(sabinDir, 'hooks', `${status}.md`);
}

export async function readHook(sabinDir: string, status: TaskStatus): Promise<string | null> {
  try {
    const text = (await fs.readFile(hookPath(sabinDir, status), 'utf8')).trim();
    return text || null;
  } catch {
    return null;
  }
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
