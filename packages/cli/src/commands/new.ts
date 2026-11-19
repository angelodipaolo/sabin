import chalk from 'chalk';
import { createTask, listTasks, projectForPath, taskFilePath } from '@sabin/core';
import { loadHome, fail, field, printJson } from '../cli';

export interface NewOptions {
  id?: string;
  /** A slug; false (`--no-project`) skips the default from the cwd */
  project?: string | false;
  content?: string;
  json?: boolean;
}

/**
 * Create a task: its directory, task.md and prompt.md. Never a worktree -
 * a task is a draft until someone runs `sabin work` on it. Without
 * `--project`, it joins the project of the cwd, if one applies.
 */
export async function newTask(title: string | undefined, options: NewOptions = {}): Promise<void> {
  const trimmed = (title ?? '').trim();
  if (!trimmed) fail('A title is required: sabin new "Add telemetry"');

  const { home, config } = await loadHome();
  let project = typeof options.project === 'string' ? options.project : undefined;
  let implied: string | null = null;
  if (options.project === undefined) {
    const here = await projectForPath(config, await listTasks(home), process.cwd());
    if (here.project) {
      project = here.project;
      implied = here.source === 'task' ? `from ${here.taskId}` : `default of repo ${here.repo?.name}`;
    }
  }

  const task = await createTask(home, config, {
    title: trimmed,
    id: options.id,
    project,
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
  if (task.project) console.log(field('Project', `${task.project}${implied ? chalk.gray(` (${implied}; --no-project to skip)`) : ''}`));
  console.log(`No worktree yet. Create one with: sabin work ${task.id}`);
}
