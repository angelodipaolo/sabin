import fs from 'fs/promises';
import { spawn } from 'child_process';
import chalk from 'chalk';
import {
  resolveSabinDir,
  readConfig,
  mainWorktreeRoot,
  codeWorkspacePath,
  writeCodeWorkspace
} from '@sabin/core';
import { getWorkspace, fail } from '../workspace-context';

interface OpenOptions {
  worktree?: boolean;
  notes?: boolean;
  prompt?: boolean;
  sabin?: boolean;
  editor?: string;
  newWindow?: boolean;
}

const TARGETS = ['worktree', 'notes', 'prompt', 'sabin'] as const;

/**
 * Open the project - or one part of a ticket - in the editor.
 *
 * With no flags this opens the generated .code-workspace, which is what makes
 * the extension able to swap folders when you switch tasks.
 */
export async function open(ticket: string | undefined, options: OpenOptions): Promise<void> {
  const selected = TARGETS.filter(key => options[key]);

  if (selected.length > 1) {
    fail('Pass at most one of --worktree, --notes, --prompt, --sabin');
  }

  const target = selected[0]
    ? await ticketTarget(selected[0], ticket)
    : await projectWorkspace();

  if (!(await exists(target))) {
    fail(`Nothing to open at ${target}` + (selected[0] === 'worktree' ? `\nRun: sabin start ${ticket ?? '<ticket>'}` : ''));
  }

  await launch(target, options);
}

async function projectWorkspace(): Promise<string> {
  const { sabinDir, projectRoot } = await resolveSabinDir();
  const mainRoot = await mainWorktreeRoot(process.cwd()) ?? projectRoot;
  const target = codeWorkspacePath(sabinDir, mainRoot);

  // Derived entirely from config, so regenerate rather than fail
  if (!(await exists(target))) {
    await writeCodeWorkspace(sabinDir, mainRoot);
  }

  return target;
}

async function ticketTarget(
  which: typeof TARGETS[number],
  ticket: string | undefined
): Promise<string> {
  const { workspace } = await getWorkspace(ticket);

  switch (which) {
    case 'worktree': return workspace.worktreeDir;
    case 'notes': return workspace.notesDir;
    case 'prompt': return workspace.promptFile;
    case 'sabin': return workspace.sabinDir;
  }
}

/**
 * Editor precedence: flag, SABIN_EDITOR, config, then VS Code
 */
async function resolveEditor(flag?: string): Promise<string> {
  if (flag) return flag;
  if (process.env.SABIN_EDITOR) return process.env.SABIN_EDITOR;

  try {
    const { sabinDir } = await resolveSabinDir();
    const config = await readConfig(sabinDir) as { editor?: string };
    if (config.editor) return config.editor;
  } catch {
    // Fall through to the default
  }

  return 'code';
}

async function launch(target: string, options: OpenOptions): Promise<void> {
  const editor = await resolveEditor(options.editor);
  const args = options.newWindow ? ['-n', target] : [target];

  const child = spawn(editor, args, { detached: true, stdio: 'ignore' });

  // Report only once the process actually started - an unresolvable editor
  // fails asynchronously, and "Opening..." followed by an error reads badly
  child.on('spawn', () => {
    console.log(chalk.gray(`Opening ${target}`));
    child.unref();
  });

  child.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      console.error(chalk.red(`Could not run "${editor}".`));
      console.error(chalk.gray(
        'Install the VS Code shell command (Shell Command: Install \'code\' command in PATH),\n' +
        'or set a different editor with --editor, SABIN_EDITOR, or "editor" in config.json.'
      ));
    } else {
      console.error(chalk.red(`Failed to open: ${error.message}`));
    }
    process.exit(1);
  });
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
