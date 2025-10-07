import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { parseTask, readConfig } from '@sabin/core';
import { Task } from '@sabin/core';

interface ListTasksOptions {
  status?: string;
}

const VALID_STATUSES = ['open', 'ready', 'in_progress', 'review', 'completed'] as const;

export async function listTasks(options: ListTasksOptions): Promise<void> {
  try {
    // Validate status if provided
    if (options.status && !VALID_STATUSES.includes(options.status as any)) {
      console.error(chalk.red(`Invalid status: ${options.status}`));
      console.error(chalk.yellow(`Valid statuses: ${VALID_STATUSES.join(', ')}`));
      process.exit(1);
    }

    const sabinDir = '.sabin';
    const tasksDir = path.join(sabinDir, 'tasks');
    const config = await readConfig(sabinDir);
    const tasks: Task[] = [];

    // Read tasks from open directory
    const openDir = path.join(tasksDir, 'open');
    try {
      const openFiles = await fs.readdir(openDir);
      for (const file of openFiles.filter(f => f.endsWith('.md'))) {
        const task = await parseTask(path.join(openDir, file));
        tasks.push(task);
      }
    } catch {
      // Directory might not exist
    }

    // Read tasks from completed directory
    const completedDir = path.join(tasksDir, 'completed');
    try {
      const completedFiles = await fs.readdir(completedDir);
      for (const file of completedFiles.filter(f => f.endsWith('.md'))) {
        const task = await parseTask(path.join(completedDir, file));
        tasks.push(task);
      }
    } catch {
      // Directory might not exist
    }

    // Filter by status if specified
    let filteredTasks = tasks;
    if (options.status) {
      filteredTasks = tasks.filter(t => t.status === options.status);
    }

    // Sort by task number
    filteredTasks.sort((a, b) => {
      const aNum = extractTaskNumber(a.path, config.projectPrefix);
      const bNum = extractTaskNumber(b.path, config.projectPrefix);
      return aNum - bNum;
    });

    // Display results
    if (filteredTasks.length === 0) {
      if (options.status) {
        console.log(chalk.yellow(`No tasks found with status: ${options.status}`));
      } else {
        console.log(chalk.yellow('No tasks found'));
      }
      return;
    }

    console.log(chalk.bold('\nTasks:'));
    console.log(chalk.gray('─'.repeat(60)));

    for (const task of filteredTasks) {
      const filename = path.basename(task.path);
      const statusColor = getStatusColor(task.status);

      console.log(`${chalk.bold(filename)}`);
      console.log(`  ${chalk.gray('Title:')} ${task.title}`);
      console.log(`  ${chalk.gray('Status:')} ${statusColor(task.status)}`);

      if (task.plan) {
        console.log(`  ${chalk.gray('Plan:')} ${chalk.cyan(task.plan)}`);
      }

      console.log(chalk.gray('─'.repeat(60)));
    }

    console.log(`\nTotal: ${chalk.bold(filteredTasks.length)} task(s)`);
  } catch (error) {
    console.error(chalk.red('Failed to list tasks'));
    console.error(error);
    process.exit(1);
  }
}

function extractTaskNumber(filepath: string, prefix: string): number {
  const regex = new RegExp(`${prefix}-(\\d+)`);
  const match = path.basename(filepath).match(regex);
  return match ? parseInt(match[1], 10) : 0;
}

function getStatusColor(status: string): (text: string) => string {
  switch (status) {
    case 'open':
      return chalk.yellow;
    case 'ready':
      return chalk.blue;
    case 'in_progress':
      return chalk.cyan;
    case 'review':
      return chalk.magenta;
    case 'completed':
      return chalk.green;
    default:
      return chalk.white;
  }
}