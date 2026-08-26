import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import chalk from 'chalk';
import ora from 'ora';

interface InstallPromptsOptions {
  agent?: string;
}

// Map of prompt file names to installed command names
const PROMPTS_MAP: Record<string, string> = {
  'task-create.md': 'sabin-task-create',
  'plan.md': 'sabin-plan',
  'task-implement.md': 'sabin-task-implement',
  'task-complete.md': 'sabin-task-complete'
};

function getSkillsDirectory(agent: string): string {
  const homeDir = os.homedir();

  switch (agent.toLowerCase()) {
    case 'claude':
    case 'claude-code':
      return path.join(homeDir, '.claude', 'skills');
    default:
      throw new Error(`Unsupported agent: ${agent}. Currently only 'claude' is supported.`);
  }
}

function getCommandsDirectory(agent: string): string {
  const homeDir = os.homedir();

  switch (agent.toLowerCase()) {
    case 'claude':
    case 'claude-code':
      return path.join(homeDir, '.claude', 'commands');
    // Future agents can be added here
    // case 'cursor':
    //   return path.join(homeDir, '.cursor', 'commands');
    // case 'cody':
    //   return path.join(homeDir, '.cody', 'commands');
    default:
      throw new Error(`Unsupported agent: ${agent}. Currently only 'claude' is supported.`);
  }
}

function getPackageRoot(): string {
  // Development:  packages/cli/dist/commands -> ../../../..
  // Installed:    node_modules/@sabin/cli/dist/commands -> ../../../..
  return path.join(__dirname, '..', '..', '..', '..');
}

/**
 * The skill is what teaches an agent to resolve paths through the CLI instead
 * of guessing, so it matters more than the slash commands
 */
async function installSkill(agent: string): Promise<string | null> {
  const source = path.join(getPackageRoot(), 'skills', 'sabin', 'SKILL.md');
  const destDir = path.join(getSkillsDirectory(agent), 'sabin');
  const dest = path.join(destDir, 'SKILL.md');

  try {
    await fs.access(source);
    await fs.mkdir(destDir, { recursive: true });
    await fs.copyFile(source, dest);
    return dest;
  } catch {
    return null;
  }
}

function getPromptsSourceDirectory(): string {
  // In development: packages/cli/dist/commands -> ../../../../prompts
  // In production (installed): node_modules/@sabin/cli/dist/commands -> ../../../../prompts
  // This works for both scenarios as prompts are at the monorepo root
  return path.join(getPackageRoot(), 'prompts');
}

export async function installPrompts(options: InstallPromptsOptions): Promise<void> {
  const agent = options.agent || 'claude';
  const spinner = ora(`Installing Sabin prompts for ${agent}...`).start();

  try {
    // Get directories
    const commandsDir = getCommandsDirectory(agent);
    const promptsSourceDir = getPromptsSourceDirectory();

    // Create commands directory if it doesn't exist
    await fs.mkdir(commandsDir, { recursive: true });

    let installedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    // Install each prompt
    for (const [sourceFile, commandName] of Object.entries(PROMPTS_MAP)) {
      const sourcePath = path.join(promptsSourceDir, sourceFile);
      const destPath = path.join(commandsDir, `${commandName}.md`);

      try {
        // Check if source file exists
        await fs.access(sourcePath);

        // Copy file
        await fs.copyFile(sourcePath, destPath);
        installedCount++;
      } catch (error) {
        failedCount++;
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push(`${commandName}: ${errorMsg}`);
      }
    }

    const skillPath = await installSkill(agent);

    if (failedCount === 0) {
      spinner.succeed(chalk.green(`Successfully installed ${installedCount} prompts for ${agent}`));

      console.log(chalk.gray('\nInstalled commands:'));
      for (const commandName of Object.values(PROMPTS_MAP)) {
        console.log(chalk.gray(`  /${commandName}`));
      }

      console.log(chalk.cyan('\nCommands installed to:'));
      console.log(chalk.cyan(`  ${commandsDir}`));

      if (skillPath) {
        console.log(chalk.gray('\nSkill installed:'));
        console.log(chalk.gray(`  ${skillPath}`));
        console.log(chalk.gray('  Teaches the agent to resolve notes paths through the CLI'));
      } else {
        console.log(chalk.yellow('\nCould not install the sabin skill - agents will not know where notes live.'));
      }

      if (agent === 'claude') {
        console.log(chalk.yellow('\nNote: You may need to restart Claude Code for the commands to appear.'));
      }
    } else {
      spinner.warn(chalk.yellow(`Installed ${installedCount} prompts, ${failedCount} failed`));

      if (errors.length > 0) {
        console.log(chalk.red('\nErrors:'));
        for (const error of errors) {
          console.log(chalk.red(`  ${error}`));
        }
      }

      process.exit(1);
    }
  } catch (error) {
    spinner.fail(chalk.red('Failed to install prompts'));

    if (error instanceof Error) {
      console.error(chalk.red(`\nError: ${error.message}`));

      // Provide helpful hints for common errors
      if (error.message.includes('EACCES')) {
        console.log(chalk.yellow('\nPermission denied. Try running with elevated privileges.'));
      } else if (error.message.includes('ENOENT')) {
        console.log(chalk.yellow('\nDirectory or file not found. Please ensure Sabin is installed correctly.'));
      }
    }

    process.exit(1);
  }
}
