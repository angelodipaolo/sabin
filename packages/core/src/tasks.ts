import fs from 'fs/promises';
import { SabinConfig, Task, TaskStatus, isTaskStatus } from './types';
import { homePaths } from './home';
import { withLock } from './lock';
import { writeFileAtomic, pathExists } from './fs';
import { parseFrontmatter, stringifyFrontmatter, asIsoDate } from './markdown';
import { parseTaskId, compareTaskIds, splitTaskId } from './ids';
import { parseProjectSlug } from './slug';
import { taskDirPath, taskFilePath, promptFilePath, promptTemplate } from './taskFiles';
import {
  SabinError,
  InvalidTaskIdError,
  InvalidTaskStatusError,
  InvalidProjectError,
  TaskExistsError,
  TaskNotFoundError
} from './errors';

/**
 * Read one task directory. Throws when task.md is missing or unreadable;
 * `listTasks` is the tolerant caller.
 */
async function readTask(home: string, id: string): Promise<Task> {
  const dir = taskDirPath(home, id);
  const file = taskFilePath(dir);
  const { data, content } = parseFrontmatter(await fs.readFile(file, 'utf8'));

  const canonical = parseTaskId(id)!;
  const task: Task = {
    id: canonical,
    // An unknown status reads as open rather than hiding the task
    status: isTaskStatus(data.status) ? data.status : 'open',
    title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : canonical,
    content,
    dir,
    file,
    promptFile: promptFilePath(dir)
  };

  const project = typeof data.project === 'string' ? parseProjectSlug(data.project) : null;
  if (project) task.project = project;
  const created = asIsoDate(data.created);
  if (created) task.created = created;

  return task;
}

/**
 * One task, or null when it does not exist. Throws `InvalidTaskIdError` for
 * something that is not an ID at all - a typo and a missing task are
 * different answers.
 */
export async function findTask(home: string, id: string): Promise<Task | null> {
  const canonical = parseTaskId(id);
  if (!canonical) throw new InvalidTaskIdError(id);
  try {
    return await readTask(home, canonical);
  } catch (error: any) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
}

/** As `findTask`, but a missing task throws `TaskNotFoundError` */
export async function getTask(home: string, id: string): Promise<Task> {
  const task = await findTask(home, id);
  if (!task) throw new TaskNotFoundError(parseTaskId(id) ?? id);
  return task;
}

/** Names under tasks/ that are valid IDs, whatever state their contents are in */
async function taskDirNames(home: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(homePaths(home).tasksDir, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory() && parseTaskId(entry.name) === entry.name)
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

/**
 * Every task, sorted by ID.
 *
 * Tolerant on purpose: a directory with a bad name, no task.md or broken
 * frontmatter is skipped, so one hand-edited file never blanks the whole list.
 */
export async function listTasks(home: string): Promise<Task[]> {
  const names = await taskDirNames(home);
  const tasks = await Promise.all(names.map(name => readTask(home, name).catch(() => null)));
  return tasks.filter((task): task is Task => task !== null).sort(compareTasks);
}

/** Sort order for tasks: by ID prefix, then numerically */
export function compareTasks(a: Task, b: Task): number {
  return compareTaskIds(a.id, b.id);
}

/**
 * Next free `<prefix>-<n>`, zero-padded to `idPadding`. A project slug
 * supplies the prefix; otherwise use the configured idPrefix.
 *
 * Counts directory names, not parsed tasks, so a task whose task.md is
 * broken still holds its number. External IDs never advance the sequence.
 */
export async function nextTaskId(home: string, config: SabinConfig, project?: string): Promise<string> {
  const projectPrefix = parseProjectSlug(project)?.replace(/-/g, '').toUpperCase();
  const prefix = projectPrefix
    ? (/^[A-Z]/.test(projectPrefix) ? projectPrefix : `P${projectPrefix}`)
    : String(config.idPrefix ?? '').toUpperCase();
  if (!parseTaskId(`${prefix}-1`)) {
    throw new SabinError(`Invalid idPrefix in config.json: "${config.idPrefix}"`, 'INVALID_CONFIG');
  }
  let max = 0;
  for (const name of await taskDirNames(home)) {
    const [namePrefix, number] = splitTaskId(name);
    if (namePrefix === prefix) max = Math.max(max, number);
  }
  return `${prefix}-${String(max + 1).padStart(config.idPadding ?? 4, '0')}`;
}

export interface CreateTaskOptions {
  title: string;
  /** External ID such as ARCH-1234; allocated from the project/config sequence when absent */
  id?: string;
  /** Project name or slug; normalised to a slug */
  project?: string;
  /** Body of task.md */
  content?: string;
  /** Defaults to today */
  created?: string;
}

/**
 * Create tasks/<ID>/ with task.md and prompt.md. Never a worktree.
 *
 * Allocation and the write happen under the lock, so two terminals creating
 * tasks at once cannot claim the same number.
 */
export async function createTask(home: string, config: SabinConfig, options: CreateTaskOptions): Promise<Task> {
  let explicit: string | null = null;
  if (options.id !== undefined && options.id.trim() !== '') {
    explicit = parseTaskId(options.id);
    if (!explicit) throw new InvalidTaskIdError(options.id);
  }

  let project: string | null = null;
  if (options.project !== undefined && options.project.trim() !== '') {
    project = parseProjectSlug(options.project);
    if (!project) throw new InvalidProjectError(options.project);
  }

  return withLock(home, async () => {
    const id = explicit ?? await nextTaskId(home, config, project ?? undefined);
    const dir = taskDirPath(home, id);
    if (await pathExists(dir)) throw new TaskExistsError(id);

    const title = options.title.trim() || id;
    const data = {
      status: 'open',
      title,
      project: project ?? undefined,
      created: options.created ?? new Date().toISOString().slice(0, 10)
    };

    await fs.mkdir(dir, { recursive: true });
    await writeFileAtomic(taskFilePath(dir), stringifyFrontmatter(data, options.content ?? ''));
    await writeFileAtomic(promptFilePath(dir), promptTemplate(id, title));

    return readTask(home, id);
  });
}

/**
 * Rewrite task.md's frontmatter under the lock, keeping the body and any
 * keys we do not know about.
 */
async function patchTask(
  home: string,
  id: string,
  patch: (data: Record<string, unknown>) => void,
  body?: string
): Promise<Task> {
  const canonical = parseTaskId(id);
  if (!canonical) throw new InvalidTaskIdError(id);

  return withLock(home, async () => {
    const file = taskFilePath(taskDirPath(home, canonical));
    let text: string;
    try {
      text = await fs.readFile(file, 'utf8');
    } catch (error: any) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') throw new TaskNotFoundError(canonical);
      throw error;
    }

    const { data, content } = parseFrontmatter(text);
    patch(data);
    await writeFileAtomic(file, stringifyFrontmatter(data, body ?? content));
    return readTask(home, canonical);
  });
}

/**
 * The one status write. Frontmatter only - nothing moves on disk - atomic,
 * and under the lock. Returns the task as it now is.
 */
export async function setTaskStatus(home: string, id: string, status: string): Promise<Task> {
  if (!isTaskStatus(status)) throw new InvalidTaskStatusError(status);
  return patchTask(home, id, data => {
    data.status = status satisfies TaskStatus;
  });
}

export interface TaskUpdate {
  title?: string;
  /** A project name or slug; null removes the task from its project */
  project?: string | null;
}

/** Edit a task's title or project. Status is deliberately not here - see `setTaskStatus`. */
export async function updateTask(home: string, id: string, update: TaskUpdate): Promise<Task> {
  let project: string | null | undefined = undefined;
  if (update.project === null || update.project?.trim() === '') {
    project = null;
  } else if (update.project !== undefined) {
    project = parseProjectSlug(update.project);
    if (!project) throw new InvalidProjectError(update.project);
  }

  return patchTask(home, id, data => {
    if (update.title !== undefined && update.title.trim()) data.title = update.title.trim();
    if (project === null) delete data.project;
    else if (project !== undefined) data.project = project;
  });
}

/**
 * Replace task.md's body - everything below the frontmatter - keeping the
 * frontmatter, unknown keys included. What an editor that shows only the body
 * saves through: title, status and project are not the body's to change, and
 * a concurrent `setTaskStatus` must not be lost to a stale buffer. Under the
 * lock, atomic.
 */
export async function setTaskBody(home: string, id: string, body: string): Promise<Task> {
  return patchTask(home, id, () => undefined, body);
}
