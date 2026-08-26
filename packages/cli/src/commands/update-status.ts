import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import {
  parseTask,
  writeTask,
  resolveSabinDir,
  getWorkingDirName,
  readConfig,
  currentBranch,
  ticketFromBranch,
  repoRoot,
  withLock
} from '@sabin/core';

type TaskStatus = 'open' | 'ready' | 'in_progress' | 'review' | 'completed';

interface UpdateStatusOptions {
  json?: boolean;
}

export async function updateStatus(
  taskId: string,
  newStatus: string,
  options: UpdateStatusOptions = {}
): Promise<void> {
  const spinner = options.json
    ? undefined
    : ora(`Updating task ${taskId} status to ${newStatus}...`).start();

  try {
    // Validate status
    const validStatuses: TaskStatus[] = ['open', 'ready', 'in_progress', 'review', 'completed'];
    if (!validStatuses.includes(newStatus as TaskStatus)) {
      throw new Error(`Invalid status: ${newStatus}. Must be one of: ${validStatuses.join(', ')}`);
    }

    // Resolve .sabin directory
    const { sabinDir, isLinked, projectRoot } = await resolveSabinDir();
    const tasksDir = path.join(sabinDir, 'tasks');

    // Find task file
    let taskPath: string | null = null;
    let currentDir: string = '';

    // Check in open directory first
    const openDir = path.join(tasksDir, 'open');
    try {
      const openFiles = await fs.readdir(openDir);
      const taskFile = openFiles.find(f =>
        f.includes(taskId) || f === `${taskId}.md`
      );
      if (taskFile) {
        taskPath = path.join(openDir, taskFile);
        currentDir = 'open';
      }
    } catch {
      // Directory might not exist
    }

    // Check in completed directory if not found
    if (!taskPath) {
      const completedDir = path.join(tasksDir, 'completed');
      try {
        const completedFiles = await fs.readdir(completedDir);
        const taskFile = completedFiles.find(f =>
          f.includes(taskId) || f === `${taskId}.md`
        );
        if (taskFile) {
          taskPath = path.join(completedDir, taskFile);
          currentDir = 'completed';
        }
      } catch {
        // Directory might not exist
      }
    }

    if (!taskPath) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Parse task
    const task = await parseTask(taskPath);
    task.status = newStatus as TaskStatus;

    // Record where the work is happening when moving to in_progress
    if (newStatus === 'in_progress') {
      if (isLinked) {
        task.workingDir = getWorkingDirName(sabinDir, projectRoot);
      }

      const config = await readConfig(sabinDir);
      const branch = await currentBranch(process.cwd());

      // Only claim the checkout when it actually belongs to this ticket
      if (branch && ticketFromBranch(branch, config) === taskId.toUpperCase()) {
        task.branch = branch;
        const here = await repoRoot(process.cwd());
        if (here) task.worktree = here;
      }
    }

    // Determine if we need to move the file
    const shouldBeInCompleted = newStatus === 'completed';
    const isInCompleted = currentDir === 'completed';

    await withLock(sabinDir, async () => {
    if (shouldBeInCompleted !== isInCompleted) {
      // Move file
      const filename = path.basename(taskPath);
      const newDir = shouldBeInCompleted ?
        path.join(tasksDir, 'completed') :
        path.join(tasksDir, 'open');

      await fs.mkdir(newDir, { recursive: true });

      const newPath = path.join(newDir, filename);

      // Update task with new path
      task.path = newPath;
      await writeTask(task);

      // Delete old file
      await fs.unlink(taskPath);

      spinner?.succeed(chalk.green(`Updated task ${taskId} status to ${newStatus}`));
      if (!options.json) {
        console.log(chalk.gray(`Moved from ${currentDir} to ${shouldBeInCompleted ? 'completed' : 'open'}`));
      }
    } else {
      // Just update status in place
      await writeTask(task);
      spinner?.succeed(chalk.green(`Updated task ${taskId} status to ${newStatus}`));
    }
    });

    if (options.json) {
      console.log(JSON.stringify({
        ticket: taskId,
        status: newStatus,
        taskFile: task.path,
        branch: task.branch ?? null,
        worktree: task.worktree ?? null
      }, null, 2));
    } else if (task.workingDir) {
      console.log(chalk.gray(`Working directory: ${task.workingDir}`));
    }
  } catch (error: any) {
    spinner?.fail(chalk.red(`Failed to update task status`));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}