import chalk from 'chalk';
import {
  setTaskStatus,
  readHook,
  isTaskStatus,
  currentBranch,
  ticketFromBranch,
  repoRoot,
  TaskNotFoundError,
  TASK_STATUSES
} from '@sabin/core';
import { loadProject, fail } from '../workspace-context';

interface UpdateStatusOptions {
  json?: boolean;
}

/**
 * Change a task's status through the CLI, which is the only writer that
 * keeps the frontmatter and the containing directory in step.
 *
 * Afterwards, print the project's hook for the new status if one exists.
 * That is how "push and open a PR" reaches an agent that just completed a
 * task: from the command it had to run anyway.
 */
export async function updateStatus(
  taskId: string,
  newStatus: string,
  options: UpdateStatusOptions = {}
): Promise<void> {
  if (!isTaskStatus(newStatus)) {
    fail(`Invalid status: ${newStatus}. Must be one of: ${TASK_STATUSES.join(', ')}`);
  }

  const { sabinDir, config } = await loadProject();
  const ticket = taskId.toUpperCase();

  // Only claim the checkout when it actually belongs to this ticket
  const patch: { branch?: string; worktree?: string } = {};
  if (newStatus === 'in_progress') {
    const branch = await currentBranch(process.cwd());
    if (branch && ticketFromBranch(branch, config) === ticket) {
      patch.branch = branch;
      const here = await repoRoot(process.cwd());
      if (here) patch.worktree = here;
    }
  }

  let task;
  try {
    task = await setTaskStatus(sabinDir, ticket, newStatus, patch);
  } catch (error) {
    if (error instanceof TaskNotFoundError) fail(error.message);
    throw error;
  }

  const hook = await readHook(sabinDir, newStatus);

  if (options.json) {
    console.log(JSON.stringify({
      ticket: task.id,
      status: task.status,
      taskFile: task.path,
      branch: task.branch ?? null,
      worktree: task.worktree ?? null,
      hook
    }, null, 2));
    return;
  }

  console.log(chalk.green(`${task.id} → ${task.status}`) + chalk.gray(`  ${task.path}`));

  if (hook) {
    console.log(chalk.bold(`\nNext, for this project (${newStatus}):\n`));
    console.log(hook);
    console.log();
  }
}
