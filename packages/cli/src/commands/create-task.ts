import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { input } from '@inquirer/prompts';
import { getNextTaskNumber, writeTask, readConfig } from '@sabin/core';
import { Task } from '@sabin/core';

interface CreateTaskOptions {
  title?: string;
  content?: string;
  number?: string;
}

export async function createTask(options: CreateTaskOptions): Promise<void> {
  let spinner: ReturnType<typeof ora> | undefined;

  try {
    const sabinDir = '.sabin';
    const tasksDir = path.join(sabinDir, 'tasks');
    const openDir = path.join(tasksDir, 'open');

    // Ensure directory exists
    await fs.mkdir(openDir, { recursive: true });

    // Read config
    const config = await readConfig(sabinDir);

    // Prompt for missing required fields
    if (!options.title) {
      options.title = await input({
        message: 'Task title:',
        validate: (value) => value.trim().length > 0 || 'Title is required'
      });
    }

    if (!options.content) {
      options.content = await input({
        message: 'Task content (optional):',
        default: ''
      });
    }

    spinner = ora('Creating task...').start();

    // Get task ID - use provided ID or generate next one
    let taskId: string;
    let filename: string;

    if (options.number) {
      // Accept any non-empty string as task ID
      const customId = options.number.trim();
      if (!customId) {
        spinner.fail(chalk.red('Task ID cannot be empty.'));
        process.exit(1);
      }

      // Use the ID as-is for the filename
      taskId = customId;
      filename = `${taskId}.md`;

      // Check if task already exists
      const testPath = path.join(openDir, filename);
      const resolvedPath = path.join(tasksDir, 'resolved', filename);
      try {
        await fs.access(testPath);
        spinner.fail(chalk.red(`Task ${taskId} already exists in open/`));
        process.exit(1);
      } catch {
        // File doesn't exist in open, check resolved
        try {
          await fs.access(resolvedPath);
          spinner.fail(chalk.red(`Task ${taskId} already exists in resolved/`));
          process.exit(1);
        } catch {
          // File doesn't exist anywhere, we can use this ID
        }
      }
    } else {
      // Generate next task number using configured prefix
      const nextNumber = await getNextTaskNumber(tasksDir, config);
      taskId = `${config.projectPrefix}-${nextNumber}`;
      filename = `${taskId}.md`;
    }

    const filePath = path.join(openDir, filename);

    // Create task object
    const task: Task = {
      status: 'open',
      title: options.title || `Task ${taskId}`,
      content: options.content || '',
      path: filePath
    };

    // Write task file
    await writeTask(task);

    spinner.succeed(chalk.green(`Created task: ${filename}`));
    console.log(chalk.gray(`Path: ${filePath}`));
  } catch (error) {
    // Re-throw process exit errors (for testing)
    if (error instanceof Error && error.message === 'Process exit') {
      throw error;
    }
    if (spinner) {
      spinner.fail(chalk.red('Failed to create task'));
    } else {
      console.error(chalk.red('Failed to create task'));
    }
    console.error(error);
    process.exit(1);
  }
}