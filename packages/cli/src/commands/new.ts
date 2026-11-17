import chalk from 'chalk';
import { createTask, taskFilePath } from '@sabin/core';
import { loadHome, fail, field, printJson } from '../cli';

export interface NewOptions {
  id?: string;
  project?: string;
  content?: string;
  json?: boolean;
}

/**
 * Create a task: its directory, task.md and prompt.md. Never a worktree -
 * a task is a draft until someone runs `sabin work` on it.
 */
export async function newTask(title: string | undefined, options: NewOptions = {}): Promise<void> {
  const trimmed = (title ?? '').trim();
  if (!trimmed) fail('A title is required: sabin new "Add telemetry"');

  const { home, config } = await loadHome();
  const task = await createTask(home, config, {
    title: trimmed,
    id: options.id,
    project: options.project,
    content: options.content ? `${options.content.trim()}\n` : undefined
  });

  if (options.json) {
    printJson({
      id: task.id,
      title: task.title,
      status: task.status,
      project: task.project ?? null,
      created: task.created ?? null,
      taskDir: task.dir,
      taskFile: taskFilePath(task.dir)
    });
    return;
  }

  console.log(`${chalk.green('Created')} ${chalk.bold(task.id)}  ${task.title}`);
  console.log(field('Task dir', task.dir));
  console.log(field('Task', task.file));
  console.log(field('Prompt', task.promptFile));
  if (task.project) console.log(field('Project', task.project));
  console.log(`No worktree yet. Create one with: sabin work ${task.id}`);
}
