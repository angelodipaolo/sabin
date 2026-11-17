import path from 'path';
import fs from 'fs/promises';
import {
  homePaths,
  parseTaskId,
  parseProjectSlug,
  taskDirPath,
  TASK_FILENAME,
  PROMPT_FILENAME,
  PLAN_FILENAME,
  LOG_FILENAME,
  RESERVED_FILENAMES
} from '@sabin/core';
import type { TaskFileKind } from '../shared/types';

/**
 * Every path the renderer can make the main process touch goes through here.
 * The renderer never sends a path: it sends a task ID and a file name, and
 * both are validated before they become one. The result is then checked once
 * more against the home, so a bug in the first check cannot reach the disk.
 */

export class PathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathError';
  }
}

const MAX_NAME = 120;

/**
 * A file name the app may create or rename to: one path segment, ending in
 * `.md` (added when missing), no leading dot, nothing a shell or Finder would
 * trip on. Returns the normalised name.
 */
export function normalizeNoteName(input: string): string {
  let name = (input ?? '').trim();
  if (!name) throw new PathError('A file name is required.');
  if (!name.toLowerCase().endsWith('.md')) name = `${name}.md`;
  else name = `${name.slice(0, -3)}.md`;
  if (name.length > MAX_NAME) throw new PathError('That file name is too long.');
  if (/[/\\:]/.test(name) || [...name].some(char => char.charCodeAt(0) < 0x20)) throw new PathError('A file name cannot contain / \\ or :.');
  if (name.startsWith('.')) throw new PathError('A file name cannot start with a dot.');
  if (name === '.md') throw new PathError('A file name is required.');
  return name;
}

/** An existing file name sent by the renderer: must already be a plain `.md` name */
export function checkFileName(name: string): string {
  if (typeof name !== 'string' || normalizeNoteName(name) !== name) {
    throw new PathError(`Not a task file: ${String(name)}`);
  }
  return name;
}

export function fileKind(name: string): TaskFileKind {
  switch (name) {
    case TASK_FILENAME: return 'task';
    case PROMPT_FILENAME: return 'prompt';
    case PLAN_FILENAME: return 'plan';
    case LOG_FILENAME: return 'log';
    default: return 'note';
  }
}

export function isReserved(name: string): boolean {
  return RESERVED_FILENAMES.includes(name);
}

function within(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Whether `target` is a markdown file the app may edit: directly inside
 * tasks/<ID>/ or directly inside projects/. Nothing deeper, nothing else.
 * Pure - see `assertRealPathAllowed` for the symlink check.
 */
export function isEditablePath(home: string, target: string): boolean {
  if (typeof target !== 'string' || !path.isAbsolute(target)) return false;
  // Judged by where it resolves to, so `..` segments cannot help
  const resolved = path.resolve(target);
  if (!resolved.endsWith('.md')) return false;

  const paths = homePaths(path.resolve(home));
  const parent = path.dirname(resolved);
  const name = path.basename(resolved);
  if (name.startsWith('.')) return false;

  if (parent === paths.projectsDir) return parseProjectSlug(name.slice(0, -3)) === name.slice(0, -3);
  if (path.dirname(parent) === paths.tasksDir) {
    const id = path.basename(parent);
    return parseTaskId(id) === id && within(resolved, paths.tasksDir);
  }
  return false;
}

/**
 * tasks/<ID>/<name> for a renderer-supplied ID and name, after validating
 * both and checking the result lands inside the home.
 */
export function taskFilePath(home: string, taskId: string, name: string): string {
  const id = parseTaskId(taskId);
  if (!id) throw new PathError(`Invalid task ID: ${String(taskId)}`);
  const file = path.join(taskDirPath(home, id), checkFileName(name));
  if (!isEditablePath(home, file)) throw new PathError(`Refusing a path outside the task: ${file}`);
  return file;
}

/**
 * The same check against real paths, so a symlinked task directory or file
 * cannot lead out of the home. Missing files are checked by their parent.
 */
export async function assertRealPathAllowed(home: string, file: string): Promise<void> {
  const realHome = await fs.realpath(home);
  let real: string;
  try {
    real = await fs.realpath(file);
  } catch {
    real = path.join(await fs.realpath(path.dirname(file)), path.basename(file));
  }
  if (!isEditablePath(realHome, real)) throw new PathError(`Refusing a path outside the home: ${file}`);
}
