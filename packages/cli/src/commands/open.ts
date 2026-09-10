import {
  parseTask,
  mainWorktreeRoot,
  codeWorkspacePath,
  writeCodeWorkspace,
  scaffoldWorkspace,
  planPath,
  feedbackPath,
  pathExists
} from '@sabin/core';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getWorkspace, loadProject, fail } from '../workspace-context';
import { launchEditor, resolveEditor } from '../editor';

const execFileAsync = promisify(execFile);

/** Matches the extension's publisher.name, which is what routes the URL */
const EXTENSION_ID = 'angelodipaolo.sabin-vscode';

interface OpenOptions {
  worktree?: boolean;
  notes?: boolean;
  prompt?: boolean;
  plan?: boolean;
  feedback?: boolean;
  task?: boolean;
  sabin?: boolean;
  editor?: string;
  newWindow?: boolean;
  reveal?: boolean;
}

const TARGETS = ['worktree', 'notes', 'prompt', 'plan', 'feedback', 'task', 'sabin'] as const;

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
    const hint = selected[0] === 'worktree' ? `\nNo worktree yet. Run: sabin implement ${ticket ?? '<ticket>'} --no-launch` :
      selected[0] === 'plan' ? `\nNo plan yet. Ask an agent: /sabin plan` :
      selected[0] === 'feedback' ? `\nNo feedback yet. Run: sabin review ${ticket ?? '<ticket>'}` : '';
    fail(`Nothing to open at ${target}${hint}`);
  }

  await launchEditor(target, options);

  if (options.reveal !== false && !selected[0]) {
    await revealSabinView(ticket, options.editor);
  }
}

/**
 * Ask the extension to show the Sabin sidebar, and the ticket if one was
 * named.
 *
 * A URL rather than anything spawned inside VS Code: `open` hands it to
 * whichever window is already running, and the extension's own reveal-on-
 * startup covers the cold case. Best effort throughout - failing to focus a
 * sidebar is not worth failing the command over, and a non-VS Code editor
 * has no such URL at all.
 */
async function revealSabinView(ticket: string | undefined, editorFlag?: string): Promise<void> {
  if (process.platform !== 'darwin') return;

  const editor = await resolveEditor(editorFlag);
  if (!editor.includes('code')) return;

  const query = ticket ? `?ticket=${encodeURIComponent(ticket)}` : '';

  try {
    await execFileAsync('open', [`vscode://${EXTENSION_ID}/focus${query}`]);
  } catch {
    // The window will still open; only the sidebar focus is lost
  }
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
    case 'feedback': return feedbackPath(workspace.notesDir);
  }
}
