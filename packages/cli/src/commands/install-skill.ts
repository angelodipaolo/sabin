import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import chalk from 'chalk';

interface InstallSkillOptions {
  agent?: string;
}

/**
 * Slash commands from earlier releases. They would shadow the skill's own
 * `/sabin` routing, so an install removes them.
 */
const STALE_COMMANDS = ['sabin-plan', 'sabin-task-complete', 'sabin-task-create', 'sabin-task-implement'];

function skillsDirectory(agent: string): string {
  switch (agent.toLowerCase()) {
    case 'claude':
    case 'claude-code':
      return path.join(os.homedir(), '.claude', 'skills');
    case 'codex':
      return path.join(os.homedir(), '.codex', 'skills');
    default:
      throw new Error(`Unsupported agent: ${agent}. Use claude or codex.`);
  }
}

/**
 * The repo's skills/sabin directory. Development and an installed package
 * both sit four levels below the package root.
 */
export function skillSourceDir(): string {
  return path.join(__dirname, '..', '..', '..', '..', 'skills', 'sabin');
}

/**
 * Install the sabin skill for an agent: SKILL.md plus its references/, which
 * is the whole workflow. There are no slash commands to install - the skill
 * is invoked as `/sabin plan`, `/sabin complete`, or in the agent's own words.
 */
export async function installSkill(options: InstallSkillOptions): Promise<void> {
  const agent = options.agent || 'claude';

  try {
    const source = skillSourceDir();
    const dest = path.join(skillsDirectory(agent), 'sabin');

    await fs.access(path.join(source, 'SKILL.md'));
    await fs.rm(dest, { recursive: true, force: true });
    await fs.cp(source, dest, { recursive: true });

    const removed = agent.startsWith('claude') ? await removeStaleCommands() : [];

    console.log(chalk.green(`Installed the sabin skill for ${agent}`));
    console.log(chalk.gray(`  ${dest}`));
    for (const file of removed) {
      console.log(chalk.gray(`  removed stale command ${file}`));
    }
    console.log(chalk.gray('\nInvoke it as /sabin plan, /sabin implement, /sabin complete - or just describe the work.'));
    console.log(chalk.yellow('Restart the agent for the change to take effect.'));
  } catch (error: any) {
    console.error(chalk.red('Failed to install the skill'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

async function removeStaleCommands(): Promise<string[]> {
  const dir = path.join(os.homedir(), '.claude', 'commands');
  const removed: string[] = [];

  for (const name of STALE_COMMANDS) {
    const file = path.join(dir, `${name}.md`);
    try {
      await fs.unlink(file);
      removed.push(file);
    } catch {
      // Not there - nothing to clean up
    }
  }

  return removed;
}
