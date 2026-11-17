import fs from 'fs/promises';
import path from 'path';
import {
  LOG_FILENAME,
  PLAN_FILENAME,
  PROMPT_FILENAME,
  TASK_FILENAME,
  getTask,
  listNotes,
  pathExists,
  setTaskBody,
  taskDirPath,
  writeFileAtomic
} from '@sabin/core';
import type { FileContent, TaskFileEntry } from '../shared/types';
import { PathError, assertRealPathAllowed, fileKind, isReserved, normalizeNoteName, taskFilePath } from './paths';

/**
 * Task files, addressed by task ID and file name - never by a path from the
 * renderer. Every function validates through `paths.ts` and re-checks the
 * real path, so a symlink cannot lead out of the home either.
 */

async function resolve(home: string, taskId: string, name: string): Promise<string> {
  const file = taskFilePath(home, taskId, name);
  await assertRealPathAllowed(home, file);
  return file;
}

export async function listTaskFiles(home: string, taskId: string): Promise<TaskFileEntry[]> {
  const task = await getTask(home, taskId);
  const fixed = [TASK_FILENAME, PROMPT_FILENAME, PLAN_FILENAME, LOG_FILENAME];
  const entries: TaskFileEntry[] = await Promise.all(fixed.map(async name => ({
    name,
    kind: fileKind(name),
    exists: await pathExists(path.join(task.dir, name))
  })));
  for (const note of await listNotes(task.dir)) {
    entries.push({ name: path.basename(note), kind: 'note', exists: true });
  }
  return entries;
}

export async function readTaskFile(home: string, taskId: string, name: string): Promise<FileContent> {
  const file = await resolve(home, taskId, name);
  if (name === TASK_FILENAME) {
    // The body only: title, status and project are the controls above the editor
    const task = await getTask(home, taskId);
    return { name, exists: true, content: task.content };
  }
  try {
    return { name, exists: true, content: await fs.readFile(file, 'utf8') };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { name, exists: false, content: '' };
    throw error;
  }
}

/** Save an editor buffer. Only existing files: a file deleted underneath is not silently recreated. */
export async function writeTaskFile(home: string, taskId: string, name: string, content: string): Promise<void> {
  if (typeof content !== 'string') throw new PathError('Content must be text.');
  const file = await resolve(home, taskId, name);
  if (name === TASK_FILENAME) {
    await setTaskBody(home, taskId, content);
    return;
  }
  if (!(await pathExists(file))) throw new Error(`${name} no longer exists on disk.`);
  await writeFileAtomic(file, content);
}

function initialContent(name: string): string {
  if (name === PLAN_FILENAME) return '# Plan\n\n';
  if (name === LOG_FILENAME) return '# Log\n\n';
  return `# ${name.slice(0, -3)}\n\n`;
}

/** Create plan.md, log.md or a note. Returns the name as created. */
export async function createTaskFile(home: string, taskId: string, requested: string): Promise<string> {
  const name = normalizeNoteName(requested);
  if (name === TASK_FILENAME || name === PROMPT_FILENAME) throw new PathError(`${name} is created with the task.`);
  await getTask(home, taskId);
  const file = await resolve(home, taskId, name);
  if (await pathExists(file)) throw new PathError(`${name} already exists.`);
  await writeFileAtomic(file, initialContent(name));
  return name;
}

/** Rename a note. The four reserved files are derived by name, so they never move. */
export async function renameTaskFile(home: string, taskId: string, from: string, requested: string): Promise<string> {
  if (isReserved(from)) throw new PathError(`${from} cannot be renamed.`);
  const to = normalizeNoteName(requested);
  if (isReserved(to)) throw new PathError(`${to} is reserved.`);
  const source = await resolve(home, taskId, from);
  const target = await resolve(home, taskId, to);
  if (to === from) return to;
  if (!(await pathExists(source))) throw new PathError(`${from} no longer exists.`);
  // Case-only renames on a case-insensitive disk are the one collision that is fine
  if (to.toLowerCase() !== from.toLowerCase() && await pathExists(target)) throw new PathError(`${to} already exists.`);
  await fs.rename(source, target);
  return to;
}

/** The path of a note for deletion, after the same checks. The caller moves it to the Trash. */
export async function deletableNote(home: string, taskId: string, name: string): Promise<string> {
  if (name === TASK_FILENAME || name === PROMPT_FILENAME) throw new PathError(`${name} cannot be deleted.`);
  const file = await resolve(home, taskId, name);
  if (!(await pathExists(file))) throw new PathError(`${name} no longer exists.`);
  // Inside the task directory, and that directory is the task's
  if (path.dirname(file) !== taskDirPath(home, taskId)) throw new PathError('Refusing to delete outside the task.');
  return file;
}
