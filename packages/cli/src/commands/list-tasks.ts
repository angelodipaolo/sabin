import chalk from 'chalk';
import {
  findPlan,
  listTasks as readTasks,
  mainWorktreeRoot,
  slugForTicket,
  workspacePaths,
  isTaskStatus,
  TASK_STATUSES,
  Task,
  TaskStatus
} from '@sabin/core';
import { loadProject, fail } from '../workspace-context';

interface ListTasksOptions {
  status?: string;
  all?: boolean;
  json?: boolean;
}

interface ListedTask {
  ticket: string;
  name: string;
  title: string;
  status: TaskStatus;
  branch: string | null;
  worktree: string | null;
  taskFile: string;
  notesDir: string;
  plan: string | null;
}

/**
 * One line per task, active work only, so the list reads as a board.
 *
 * Completed tasks are hidden unless asked for: a command center shows what
 * is in flight, not the whole history.
 */
export async function listTasks(options: ListTasksOptions): Promise<void> {
  if (options.status && !isTaskStatus(options.status)) {
    fail(`Invalid status: ${options.status}. Must be one of: ${TASK_STATUSES.join(', ')}`);
  }

  const { sabinDir, projectRoot, config } = await loadProject();
  const mainRoot = await mainWorktreeRoot(projectRoot);

  let tasks = await readTasks(sabinDir);
  if (options.status) {
    tasks = tasks.filter(task => task.status === options.status);
  } else if (!options.all) {
    tasks = tasks.filter(task => task.status !== 'completed');
  }

  const listed: ListedTask[] = [];
  for (const task of tasks) {
    const slug = await slugForTicket(task.id, task.slug, task.title, sabinDir, config);
    const paths = workspacePaths({ ticket: task.id, slug }, sabinDir, mainRoot, config);
    listed.push({
      ticket: task.id,
      name: paths.name,
      title: task.title,
      status: task.status,
      branch: task.branch ?? null,
      worktree: task.worktree ?? null,
      taskFile: task.path,
      notesDir: paths.notesDir,
      plan: await findPlan(paths.notesDir)
    });
  }

  if (options.json) {
    console.log(JSON.stringify(listed, null, 2));
    return;
  }

  if (listed.length === 0) {
    console.log(chalk.gray(options.status ? `No ${options.status} tasks` : 'No open tasks'));
    return;
  }

  const idWidth = Math.max(...listed.map(task => task.ticket.length));

  for (const task of listed) {
    const marks = [task.plan ? chalk.magenta('plan') : null, task.worktree ? chalk.cyan('worktree') : null]
      .filter(Boolean)
      .join(' ');
    console.log(
      `${chalk.bold(task.ticket.padEnd(idWidth))}  ${colorStatus(task.status)}  ${task.title}` +
      (marks ? chalk.gray('  ') + marks : '')
    );
  }
}

function colorStatus(status: Task['status']): string {
  const label = status.padEnd(11);
  switch (status) {
    case 'open': return chalk.yellow(label);
    case 'ready': return chalk.blue(label);
    case 'in_progress': return chalk.cyan(label);
    case 'review': return chalk.magenta(label);
    case 'completed': return chalk.green(label);
  }
}
