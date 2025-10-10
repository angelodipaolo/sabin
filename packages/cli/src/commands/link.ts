import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { confirm } from '@inquirer/prompts';
import { writeSabinLink, checkSabinType } from '@sabin/core';

export async function linkToSharedSabin(targetPath: string): Promise<void> {
  const spinner = ora('Linking to shared .sabin...').start();

  try {
    const projectRoot = process.cwd();
    const resolvedTarget = path.resolve(projectRoot, targetPath);

    // Verify target .sabin exists and is a directory
    try {
      const stat = await fs.stat(resolvedTarget);
      if (!stat.isDirectory()) {
        throw new Error(`${targetPath} is not a directory`);
      }

      // Verify it's a valid .sabin directory (has config.json)
      const configPath = path.join(resolvedTarget, 'config.json');
      await fs.access(configPath);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(
          `${targetPath} is not a valid .sabin directory.\n` +
          `Expected to find config.json at: ${path.join(targetPath, 'config.json')}`
        );
      }
      throw error;
    }

    // Check if .sabin already exists in current directory
    const currentType = await checkSabinType(projectRoot);

    if (currentType === 'directory') {
      spinner.warn(chalk.yellow('.sabin directory already exists'));
      const shouldReplace = await confirm({
        message: 'Replace local .sabin directory with link to shared directory? This will DELETE the local directory.',
        default: false
      });

      if (!shouldReplace) {
        spinner.info('Cancelled');
        return;
      }

      // Remove existing directory
      await fs.rm(path.join(projectRoot, '.sabin'), { recursive: true, force: true });
      spinner.text = 'Removed local .sabin directory...';
    } else if (currentType === 'file') {
      throw new Error(
        '.sabin link already exists.\n' +
        'Remove it first if you want to link to a different directory.'
      );
    }

    // Create .sabin link file
    await writeSabinLink(projectRoot, resolvedTarget);

    spinner.succeed(chalk.green('Successfully linked to shared .sabin'));
    console.log(chalk.gray(`Target: ${resolvedTarget}`));
    console.log(chalk.gray(`Link file: ${path.join(projectRoot, '.sabin')}`));
  } catch (error: any) {
    spinner.fail(chalk.red('Failed to link to shared .sabin'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}
