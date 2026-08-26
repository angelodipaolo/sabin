import fs from 'fs/promises';
import path from 'path';
import {
  writeTask,
  withLock,
  WorkspacePaths,
  Task
} from '@sabin/core';

const PROMPT_TEMPLATE = (name: string, title: string) =>
  `# ${name} - ${title}\n\n` +
  `Scratchpad for prompts. Not visible to the agent.\n\n---\n\n`;

/**
 * Turn "update-telemetry" back into "Update telemetry" for a task title
 */
export function titleFromSlug(slug: string): string {
  const words = slug.replace(/-/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Create the notes directory and prompt scratchpad for a ticket.
 *
 * Deliberately independent of status and worktrees: drafting a prompt is
 * something you do before deciding to start work.
 */
export async function ensureWorkspaceFiles(
  paths: WorkspacePaths,
  title: string,
  created: string[] = []
): Promise<string[]> {
  if (!(await exists(paths.notesDir))) {
    await fs.mkdir(paths.notesDir, { recursive: true });
    created.push(paths.notesDir);
  }

  if (!(await exists(paths.promptFile))) {
    await fs.mkdir(path.dirname(paths.promptFile), { recursive: true });
    await fs.writeFile(paths.promptFile, PROMPT_TEMPLATE(paths.name, title));
    created.push(paths.promptFile);
  }

  return created;
}

/**
 * Create the task file for a ticket that does not have one yet
 */
export async function createTaskFile(
  sabinDir: string,
  ticket: string,
  slug: string | null,
  title?: string
): Promise<string> {
  const openDir = path.join(sabinDir, 'tasks', 'open');
  await fs.mkdir(openDir, { recursive: true });

  const task: Task = {
    status: 'open',
    title: title ?? (slug ? titleFromSlug(slug) : ticket),
    content: '',
    path: path.join(openDir, `${ticket}.md`)
  };
  if (slug) task.slug = slug;

  await withLock(sabinDir, () => writeTask(task));
  return task.path;
}

export async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
