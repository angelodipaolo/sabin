import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import ora from 'ora';
import { input, select } from '@inquirer/prompts';
import {
  writeConfig,
  readConfig,
  getDefaultConfig,
  checkSabinType,
  writeSabinLink,
  writeCodeWorkspace,
  denyPromptsAccess,
  addGitExclude,
  git,
  SabinConfig
} from '@sabin/core';

interface InitOptions {
  prefix?: string;
  shared?: string;
  local?: boolean;
  branchPrefix?: string;
  worktrees?: string;
  /** Commander sets this false for --no-exclude */
  exclude?: boolean;
}

export async function initProject(options: InitOptions): Promise<void> {
  const projectRoot = process.cwd();

  try {
    const existingType = await checkSabinType(projectRoot);
    if (existingType !== 'none') {
      throw new Error(
        `.sabin already exists in this directory.\n` +
        `To point it somewhere else, remove it and run: sabin init --shared <path>`
      );
    }

    const sabinDir = await chooseLocation(projectRoot, options);
    const isShared = sabinDir !== path.join(projectRoot, '.sabin');
    const alreadySetUp = await hasConfig(sabinDir);

    // Every question is asked before the spinner starts - ora repaints over
    // inquirer, so a prompt raised mid-spin is invisible and looks like a hang
    const config = alreadySetUp ? null : await buildConfig(projectRoot, options);

    const spinner = ora(alreadySetUp ? 'Linking to shared .sabin...' : 'Initializing Sabin...').start();

    if (config) {
      await scaffold(sabinDir);
      await writeConfig(config, sabinDir);
    }

    // The extension swaps ticket folders inside this workspace file
    const codeWorkspace = await writeCodeWorkspace(sabinDir, projectRoot);

    // Stop agents reading the prompt scratchpads
    const promptsDir = path.resolve(sabinDir, (await readConfig(sabinDir)).promptsDir ?? 'prompts');
    const denied = await denyPromptsAccess(projectRoot, promptsDir);

    // A shared directory lives outside the repo, so the repo needs a pointer
    let excluded = false;
    if (isShared) {
      await writeSabinLink(projectRoot, sabinDir);
      if (options.exclude !== false) {
        excluded = await addGitExclude(projectRoot);
      }
    }

    spinner.succeed(chalk.green(alreadySetUp ? 'Linked to shared .sabin' : 'Sabin initialized'));
    await report(sabinDir, projectRoot, isShared, alreadySetUp, excluded, codeWorkspace, denied.path);
  } catch (error: any) {
    if (error?.name === 'ExitPromptError') {
      console.error(chalk.yellow('\nCancelled'));
      process.exit(1);
    }
    console.error(chalk.red('Failed to initialize Sabin'));
    console.error(chalk.red(error.message));
    process.exit(1);
  }
}

/**
 * Decide where the .sabin directory lives.
 *
 * Non-interactive runs default to a local directory, so scripts and existing
 * setups behave exactly as before.
 */
async function chooseLocation(projectRoot: string, options: InitOptions): Promise<string> {
  if (options.shared) {
    return path.resolve(projectRoot, expandHome(options.shared));
  }
  if (options.local || !isInteractive()) {
    return path.join(projectRoot, '.sabin');
  }

  const suggestion = path.join(os.homedir(), 'notes', path.basename(projectRoot), '.sabin');

  const choice = await select({
    message: 'Where should the Sabin directory live?',
    choices: [
      {
        name: `Outside the repo, shared across worktrees  ${chalk.gray(`(${tildify(suggestion)})`)}`,
        value: 'shared',
        description: 'Survives git clean, invisible to other contributors, and every worktree sees the same tasks'
      },
      {
        name: 'Inside the repo, committed with the code',
        value: 'local',
        description: 'Task history lives alongside the code. Simplest for solo projects.'
      }
    ]
  });

  if (choice === 'local') {
    return path.join(projectRoot, '.sabin');
  }

  const answer = await input({
    message: 'Shared .sabin path:',
    default: tildify(suggestion)
  });

  return path.resolve(projectRoot, expandHome(answer.trim() || suggestion));
}

async function buildConfig(
  projectRoot: string,
  options: InitOptions
): Promise<SabinConfig> {
  const config = getDefaultConfig();

  config.projectPrefix = options.prefix
    ?? (isInteractive()
      ? await input({
          message: 'Project prefix for task IDs:',
          default: defaultPrefix(projectRoot)
        })
      : defaultPrefix(projectRoot));

  const branchPrefix = options.branchPrefix
    ?? (isInteractive()
      ? await input({
          message: 'Branch prefix (blank for none):',
          default: await defaultBranchPrefix(projectRoot)
        })
      : undefined);

  if (branchPrefix) {
    config.branch = { prefix: branchPrefix.trim() };
  }
  if (options.worktrees) {
    config.worktrees = { root: options.worktrees };
  }

  return config;
}

async function scaffold(sabinDir: string): Promise<void> {
  const dirs = [
    path.join(sabinDir, 'tasks', 'open'),
    path.join(sabinDir, 'tasks', 'completed'),
    path.join(sabinDir, 'plans'),
    path.join(sabinDir, 'research'),
    path.join(sabinDir, 'notes'),
    path.join(sabinDir, 'prompts')
  ];

  for (const dir of dirs) {
    await fs.mkdir(dir, { recursive: true });
  }
}


async function report(
  sabinDir: string,
  projectRoot: string,
  isShared: boolean,
  alreadySetUp: boolean,
  excluded: boolean,
  codeWorkspace: string,
  denyRulePath: string
): Promise<void> {
  const config = await readConfig(sabinDir);

  console.log(chalk.gray(`\nSabin directory: ${tildify(sabinDir)}`));
  if (isShared) {
    console.log(chalk.gray(`Link file:       ${tildify(path.join(projectRoot, '.sabin'))}`));
    console.log(chalk.gray(`Locally ignored: ${excluded ? '.git/info/exclude' : chalk.yellow('no - add .sabin to your ignores')}`));
  }

  if (!alreadySetUp) {
    console.log(chalk.gray('\n  tasks/{open,completed}   plans/   research/'));
    console.log(chalk.gray('  notes/     per-ticket, agent readable'));
    console.log(chalk.gray('  prompts/   per-ticket scratchpads, agent denied'));
  }

  console.log(chalk.gray(`Prompts denied: ${path.relative(projectRoot, denyRulePath)}`));
  console.log(chalk.cyan(`\nTask prefix:   ${config.projectPrefix}`));
  if (config.branch?.prefix) {
    console.log(chalk.cyan(`Branch prefix: ${config.branch.prefix}`));
  }

  const example = `${config.projectPrefix}-0001-my-first-change`;
  console.log(chalk.gray('\nStart working:'));
  console.log(chalk.gray(`  sabin start ${example}`));
  console.log(chalk.gray('\nOpen the board, notes and prompts in VS Code:'));
  console.log(chalk.gray(`  code ${JSON.stringify(tildify(codeWorkspace))}\n`));
}

function defaultPrefix(projectRoot: string): string {
  const name = path.basename(projectRoot).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return name.slice(0, 10) || 'TASK';
}

/**
 * Guess a personal branch prefix from the git identity, e.g. "angelo"
 */
async function defaultBranchPrefix(projectRoot: string): Promise<string> {
  try {
    const name = await git(['config', 'user.name'], projectRoot);
    return name.trim().split(/\s+/)[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
  } catch {
    return '';
  }
}

async function hasConfig(sabinDir: string): Promise<boolean> {
  try {
    return (await fs.stat(path.join(sabinDir, 'config.json'))).isFile();
  } catch {
    return false;
  }
}

function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function expandHome(target: string): string {
  return target.startsWith('~') ? path.join(os.homedir(), target.slice(1)) : target;
}

function tildify(target: string): string {
  const home = os.homedir();
  return target.startsWith(home) ? `~${target.slice(home.length)}` : target;
}
