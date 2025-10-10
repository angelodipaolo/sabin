import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { writeConfig, getDefaultConfig, checkSabinType } from '@sabin/core';

interface InitOptions {
  prefix: string;
}

export async function initProject(options: InitOptions): Promise<void> {
  const spinner = ora('Initializing Sabin project structure...').start();

  try {
    const projectRoot = process.cwd();
    const sabinType = await checkSabinType(projectRoot);

    if (sabinType !== 'none') {
      throw new Error(
        `.sabin already exists in this directory.\n` +
        `To link to a shared .sabin, remove the existing one and run: sabin link <path>`
      );
    }

    const sabinDir = path.join(projectRoot, '.sabin');

    // Create directory structure
    const dirs = [
      path.join(sabinDir, 'tasks', 'open'),
      path.join(sabinDir, 'tasks', 'completed'),
      path.join(sabinDir, 'plans'),
      path.join(sabinDir, 'research')
    ];

    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }

    // Create config file with required prefix
    const config = getDefaultConfig();
    config.projectPrefix = options.prefix;
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
    console.log(chalk.cyan(`\nProject prefix set to: ${options.prefix}`));
    console.log(chalk.gray(`Location: ${sabinDir}`));
  } catch (error: any) {
    spinner.fail(chalk.red('Failed to initialize Sabin project'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}