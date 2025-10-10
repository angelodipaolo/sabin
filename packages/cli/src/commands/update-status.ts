import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import {
  parseTask,
  writeTask,
  resolveSabinDir,
  getWorkingDirName
} from '@sabin/core';

type TaskStatus = 'open' | 'ready' | 'in_progress' | 'review' | 'completed';

export async function updateStatus(taskId: string, newStatus: string): Promise<void> {
  const spinner = ora(`Updating task ${taskId} status to ${newStatus}...`).start();

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

    // Update working directory when moving to in_progress
    if (newStatus === 'in_progress' && isLinked) {
      task.workingDir = getWorkingDirName(sabinDir, projectRoot);
    }

    // Determine if we need to move the file
    const shouldBeInCompleted = newStatus === 'completed';
    const isInCompleted = currentDir === 'completed';

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

      spinner.succeed(chalk.green(`Updated task ${taskId} status to ${newStatus}`));
      console.log(chalk.gray(`Moved from ${currentDir} to ${shouldBeInCompleted ? 'completed' : 'open'}`));
    } else {
      // Just update status in place
      await writeTask(task);
      spinner.succeed(chalk.green(`Updated task ${taskId} status to ${newStatus}`));
    }

    if (task.workingDir) {
      console.log(chalk.gray(`Working directory: ${task.workingDir}`));
    }
  } catch (error: any) {
    spinner.fail(chalk.red(`Failed to update task status`));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}