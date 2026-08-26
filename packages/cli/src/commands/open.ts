import {
  parseTask,
  mainWorktreeRoot,
  codeWorkspacePath,
  writeCodeWorkspace,
  scaffoldWorkspace,
  planPath,
  pathExists
} from '@sabin/core';
import { getWorkspace, loadProject, fail } from '../workspace-context';
import { launchEditor } from '../editor';

interface OpenOptions {
  worktree?: boolean;
  notes?: boolean;
  prompt?: boolean;
  plan?: boolean;
  task?: boolean;
  sabin?: boolean;
  editor?: string;
  newWindow?: boolean;
}

const TARGETS = ['worktree', 'notes', 'prompt', 'plan', 'task', 'sabin'] as const;

/**
 * Open the project - or one part of a ticket - in the editor.
 *
 * With no flags this opens the generated .code-workspace, which is what makes
 * the extension able to swap folders when you switch tasks. Notes and the
 * prompt scratchpad are derived paths, so they get created on the way in
 * rather than failing for not existing yet.
 */
export async function open(ticket: string | undefined, options: OpenOptions): Promise<void> {
  const selected = TARGETS.filter(key => options[key]);

  if (selected.length > 1) {
    fail(`Pass at most one of ${TARGETS.map(key => `--${key}`).join(', ')}`);
  }

  const target = selected[0]
    ? await ticketTarget(selected[0], ticket)
    : await projectWorkspace();

  if (!(await pathExists(target))) {
    const hint = selected[0] === 'worktree' ? `\nRun: sabin start ${ticket ?? '<ticket>'}` :
      selected[0] === 'plan' ? `\nNo plan yet. Ask an agent: /sabin plan` : '';
    fail(`Nothing to open at ${target}${hint}`);
  }

  await launchEditor(target, options);
}

async function projectWorkspace(): Promise<string> {
  const { sabinDir, projectRoot } = await loadProject();
  const mainRoot = await mainWorktreeRoot(process.cwd()) ?? projectRoot;
  const target = codeWorkspacePath(sabinDir, mainRoot);

  // Derived entirely from config, so regenerate rather than fail
  if (!(await pathExists(target))) {
    await writeCodeWorkspace(sabinDir, mainRoot);
  }

  return target;
}

async function ticketTarget(
  which: typeof TARGETS[number],
  ticket: string | undefined
): Promise<string> {
  const { workspace } = await getWorkspace(ticket);

  if (which === 'sabin') return workspace.sabinDir;
  if (which === 'worktree') return workspace.worktreeDir;
  if (which === 'task') {
    if (!workspace.taskFile) fail(`No task file found for ${workspace.ticket}`);
    return workspace.taskFile;
  }

  if (workspace.taskFile) {
    const task = await parseTask(workspace.taskFile);
    await scaffoldWorkspace(workspace, task.title);
  }

  switch (which) {
    case 'notes': return workspace.notesDir;
    case 'prompt': return workspace.promptFile;
    case 'plan': return planPath(workspace.notesDir);
  }
}
