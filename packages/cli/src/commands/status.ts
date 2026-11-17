import chalk from 'chalk';
import { findHook, isTaskId, isTaskStatus, listTasks, repoForPath, setTaskStatus } from '@sabin/core';
import { loadHome, fail, field, colorStatus, resolveTaskId, VALID_STATUSES } from '../cli';

const USAGE = 'sabin status <id> <status>';

/**
 * The one status write, then the hook for the new status.
 *
 * `sabin status <id> <status>`, or `sabin status <status>` inside a task's
 * worktree. When the cwd is inside a registered repo, that repo's hook
 * (`hooks/<repo>/<status>.md`) wins over the global one - this is how "push
 * and open a PR" reaches an agent from the command it had to run anyway.
 */
export async function status(first: string, second?: string): Promise<void> {
  const [id, wanted] = second === undefined ? [undefined, first] : [first, second];

  if (!isTaskStatus(wanted)) {
    if (second === undefined && isTaskId(wanted)) {
      fail(`Missing status. Usage: ${USAGE}. Valid statuses: ${VALID_STATUSES}`);
    }
    fail(`Unknown status "${wanted}". Valid statuses: ${VALID_STATUSES}`);
  }

  const { home, config } = await loadHome();
  const tasks = await listTasks(home);
  const taskId = await resolveTaskId(config, tasks, id, USAGE);
  const previous = tasks.find(task => task.id === taskId)?.status;

  const task = await setTaskStatus(home, taskId, wanted);
  const repo = await repoForPath(config, process.cwd());
  const hook = await findHook(home, wanted, repo?.name);

  const change = previous && previous !== task.status
    ? `${colorStatus(previous)} → ${colorStatus(task.status)}`
    : `${colorStatus(task.status)} ${chalk.gray('(unchanged)')}`;
  console.log(`${chalk.bold(task.id)}  ${change}  ${task.title}`);
  console.log(field('Task', task.file));

  if (!hook) {
    console.log(field('Hook', chalk.gray(`none for ${wanted}`)));
    return;
  }
  console.log(field('Hook', hook.file));
  console.log();
  console.log(hook.text);
}
