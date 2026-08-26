import fs from 'fs/promises';
import {
  resolveSabinDir,
  mainWorktreeRoot,
  codeWorkspacePath,
  writeCodeWorkspace
} from '@sabin/core';
import { getWorkspace, fail } from '../workspace-context';
import { launchEditor } from '../editor';

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

  await launchEditor(target, options);
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

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
