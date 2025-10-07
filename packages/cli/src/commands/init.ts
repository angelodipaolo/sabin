import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { writeConfig, getDefaultConfig } from '@sabin/core';

interface InitOptions {
  prefix?: string;
}

export async function initProject(options: InitOptions = {}): Promise<void> {
  const spinner = ora('Initializing Sabin project structure...').start();

  try {
    const sabinDir = '.sabin';
    const dirs = [
      path.join(sabinDir, 'tasks', 'open'),
      path.join(sabinDir, 'tasks', 'completed'),
      path.join(sabinDir, 'plans'),
      path.join(sabinDir, 'research')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }

    // Create config file with custom prefix if provided
    const config = getDefaultConfig();
    if (options.prefix) {
      config.projectPrefix = options.prefix;
    }
    await writeConfig(config, sabinDir);

    spinner.succeed(chalk.green('Sabin project initialized successfully!'));
    console.log(chalk.gray('\nCreated structure:'));
    console.log(chalk.gray('  .sabin/'));
    console.log(chalk.gray('  ├── config.json'));
    console.log(chalk.gray('  ├── tasks/'));
    console.log(chalk.gray('  │   ├── open/'));
    console.log(chalk.gray('  │   └── completed/'));
    console.log(chalk.gray('  ├── plans/'));
    console.log(chalk.gray('  └── research/'));
    if (options.prefix) {
      console.log(chalk.cyan(`\nProject prefix set to: ${options.prefix}`));
    }
  } catch (error) {
    spinner.fail(chalk.red('Failed to initialize Sabin project'));
    console.error(error);
    process.exit(1);
  }
}