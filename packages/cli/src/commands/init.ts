import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import chalk from 'chalk';
import { input } from '@inquirer/prompts';
import {
  writeConfig,
  readConfig,
  getDefaultConfig,
  checkSabinType,
  writeSabinLink,
  writeCodeWorkspace,
  denyPromptsAccess,
  addGitExclude,
  hookPath,
  git,
  SabinConfig
} from '@sabin/core';

interface InitOptions {
  prefix?: string;
  shared?: string;
  branchPrefix?: string;
  worktrees?: string;
  /** Commander sets this false for --no-exclude */
  exclude?: boolean;
}

const HOOKS_README = `# Hooks

Project instructions for an agent moving a task to a status. Write them to
\`<status>.md\` in this directory - \`completed.md\`, \`review.md\` - and
\`sabin task update\` prints the file after the change lands.

Example \`completed.md\`:

    Push the branch and open a pull request with \`gh pr create --fill\`.
    Leave the worktree in place.
`;

/**
 * Set up Sabin for the repo you are standing in.
 *
 * The Sabin directory always lives outside the repo: worktrees each check
 * out their own copy of anything committed, so an in-repo directory would
 * show every worktree a different, stale board. The repo gets a link file,
 * ignored locally, that every worktree resolves through.
 */
export async function initProject(options: InitOptions): Promise<void> {
  const projectRoot = process.cwd();

  try {
    if ((await checkSabinType(projectRoot)) !== 'none') {
      throw new Error(
        `.sabin already exists in this directory.\n` +
        `To point it somewhere else, remove it and run: sabin init --shared <path>`
      );
    }

    const sabinDir = await chooseLocation(projectRoot, options);
    const alreadySetUp = await hasConfig(sabinDir);
    const config = alreadySetUp ? null : await buildConfig(projectRoot, options);

    if (config) {
      await scaffold(sabinDir);
      await writeConfig(config, sabinDir);
    }

    // The extension swaps ticket folders inside this workspace file
    await writeCodeWorkspace(sabinDir, projectRoot);

    // Stop agents reading the prompt scratchpads
    const promptsDir = path.resolve(sabinDir, (await readConfig(sabinDir)).promptsDir ?? 'prompts');
    const denied = await denyPromptsAccess(projectRoot, promptsDir);

    await writeSabinLink(projectRoot, sabinDir);
    const excluded = options.exclude !== false && await addGitExclude(projectRoot);

    console.log(chalk.green(alreadySetUp ? 'Linked to existing Sabin directory' : 'Sabin initialized'));
    await report(sabinDir, projectRoot, alreadySetUp, excluded, denied.path);
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

async function chooseLocation(projectRoot: string, options: InitOptions): Promise<string> {
  const suggestion = path.join(os.homedir(), 'notes', path.basename(projectRoot), '.sabin');

  if (options.shared) {
    return path.resolve(projectRoot, expandHome(options.shared));
  }
  if (!isInteractive()) {
    return suggestion;
  }

  const answer = await input({
    message: 'Sabin directory (outside the repo, shared by every worktree):',
    default: tildify(suggestion)
  });

  return path.resolve(projectRoot, expandHome(answer.trim() || suggestion));
}

async function buildConfig(projectRoot: string, options: InitOptions): Promise<SabinConfig> {
  const config = getDefaultConfig();

  config.projectPrefix = options.prefix
    ?? (isInteractive()
      ? await input({ message: 'Project prefix for task IDs:', default: defaultPrefix(projectRoot) })
      : defaultPrefix(projectRoot));

  const branchPrefix = options.branchPrefix
    ?? (isInteractive()
      ? await input({ message: 'Branch prefix (blank for none):', default: await defaultBranchPrefix(projectRoot) })
      : await defaultBranchPrefix(projectRoot));

  if (branchPrefix?.trim()) {
    config.branch = { prefix: branchPrefix.trim() };
  }
  if (options.worktrees) {
    config.worktrees = { root: options.worktrees };
  }

  return config;
}

async function scaffold(sabinDir: string): Promise<void> {
  for (const dir of ['tasks/open', 'tasks/completed', 'research', 'notes', 'prompts', 'hooks']) {
    await fs.mkdir(path.join(sabinDir, dir), { recursive: true });
  }
  await fs.writeFile(path.join(path.dirname(hookPath(sabinDir, 'completed')), 'README.md'), HOOKS_README);
}

async function report(
  sabinDir: string,
  projectRoot: string,
  alreadySetUp: boolean,
  excluded: boolean,
  denyRulePath: string
): Promise<void> {
  const config = await readConfig(sabinDir);

  console.log(chalk.gray(`\nSabin directory: ${tildify(sabinDir)}`));
  console.log(chalk.gray(`Link file:       ${tildify(path.join(projectRoot, '.sabin'))}`));
  console.log(chalk.gray(`Locally ignored: ${excluded ? '.git/info/exclude' : chalk.yellow('no - add .sabin to your ignores')}`));
  console.log(chalk.gray(`Prompts denied:  ${path.relative(projectRoot, denyRulePath)}`));

  if (!alreadySetUp) {
    console.log(chalk.gray('\n  tasks/{open,completed}   research/'));
    console.log(chalk.gray('  notes/     per-ticket, agent readable'));
    console.log(chalk.gray('  prompts/   per-ticket scratchpads, agent denied'));
    console.log(chalk.gray('  hooks/     per-status instructions, e.g. completed.md'));
  }

  console.log(chalk.cyan(`\nTask prefix:   ${config.projectPrefix}`));
  if (config.branch?.prefix) {
    console.log(chalk.cyan(`Branch prefix: ${config.branch.prefix}`));
  }

  console.log(chalk.gray('\nCreate a task, then hand it to an agent:'));
  console.log(chalk.gray(`  sabin task create "My first change" --open`));
  console.log(chalk.gray(`  sabin run ${config.projectPrefix}-0001`));
  console.log(chalk.gray('\nOpen the board, notes and prompts in VS Code:'));
  console.log(chalk.gray('  sabin open\n'));
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

export function expandHome(target: string): string {
  return target.startsWith('~') ? path.join(os.homedir(), target.slice(1)) : target;
}

export function tildify(target: string): string {
  const home = os.homedir();
  return target.startsWith(home) ? `~${target.slice(home.length)}` : target;
}
