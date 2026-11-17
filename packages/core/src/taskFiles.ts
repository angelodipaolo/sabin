import fs from 'fs/promises';
import path from 'path';
import { homePaths } from './home';
import { parseTaskId } from './ids';
import { pathExists } from './fs';
import { InvalidTaskIdError } from './errors';

export const TASK_FILENAME = 'task.md';
export const PROMPT_FILENAME = 'prompt.md';
export const PLAN_FILENAME = 'plan.md';
export const LOG_FILENAME = 'log.md';

/** The files in a task directory that are not notes */
export const RESERVED_FILENAMES: readonly string[] = [TASK_FILENAME, PROMPT_FILENAME, PLAN_FILENAME, LOG_FILENAME];

/**
 * tasks/<ID>. Validates the ID - this is the one place an ID becomes a path,
 * so `../x` is refused here whatever the caller forgot.
 */
export function taskDirPath(home: string, id: string): string {
  const canonical = parseTaskId(id);
  if (!canonical) throw new InvalidTaskIdError(id);
  return path.join(homePaths(home).tasksDir, canonical);
}

export function taskFilePath(taskDir: string): string {
  return path.join(taskDir, TASK_FILENAME);
}

export function promptFilePath(taskDir: string): string {
  return path.join(taskDir, PROMPT_FILENAME);
}

/** Where the task's one plan lives, whether or not it exists yet */
export function planPath(taskDir: string): string {
  return path.join(taskDir, PLAN_FILENAME);
}

/** The plan, or null before one is written. The only answer to "does it have a plan". */
export async function findPlan(taskDir: string): Promise<string | null> {
  const file = planPath(taskDir);
  return (await pathExists(file)) ? file : null;
}

/** Where session handoffs are appended, whether or not it exists yet */
export function logPath(taskDir: string): string {
  return path.join(taskDir, LOG_FILENAME);
}

export async function findLog(taskDir: string): Promise<string | null> {
  const file = logPath(taskDir);
  return (await pathExists(file)) ? file : null;
}

/**
 * Every note in a task directory: each `.md` file except the reserved four,
 * sorted by name. Subdirectories are not walked.
 */
export async function listNotes(taskDir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(taskDir, { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.md') && !RESERVED_FILENAMES.includes(entry.name))
    .map(entry => entry.name)
    .sort()
    .map(name => path.join(taskDir, name));
}

export function promptTemplate(id: string, title: string): string {
  return `# ${id} - ${title}\n\nScratchpad for prompts. Agents never read this file.\n\n---\n\n`;
}
