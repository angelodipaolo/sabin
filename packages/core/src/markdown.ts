import matter from 'gray-matter';
import fs from 'fs/promises';
import path from 'path';
import { Task, TaskStatus, isTaskStatus } from './types';

/**
 * Statuses written by earlier versions, read back as their current name so
 * old task files keep working without a migration.
 */
const LEGACY_STATUSES: Record<string, TaskStatus> = {
  resolved: 'completed'
};

export function normalizeStatus(value: unknown): TaskStatus {
  if (typeof value !== 'string') return 'open';
  if (isTaskStatus(value)) return value;
  return LEGACY_STATUSES[value] ?? 'open';
}

export async function parseTask(filePath: string): Promise<Task> {
  const content = await fs.readFile(filePath, 'utf8');
  const { data, content: body } = matter(content);

  const id = path.basename(filePath, '.md');

  return {
    id,
    status: normalizeStatus(data.status),
    title: data.title ? String(data.title) : id,
    slug: data.slug,
    branch: data.branch,
    worktree: data.worktree,
    content: body,
    path: filePath
  };
}

/**
 * Write a task file. `id` and `path` describe the file rather than the task,
 * so only the remaining fields land in frontmatter.
 */
export async function writeTask(task: Task): Promise<void> {
  const { path: taskPath, content, ...rest } = task;

  const cleanFrontmatter = Object.fromEntries(
    Object.entries(rest).filter(([key, value]) => key !== 'id' && value !== undefined)
  );

  await fs.mkdir(path.dirname(taskPath), { recursive: true });
  await fs.writeFile(taskPath, matter.stringify(content, cleanFrontmatter));
}
