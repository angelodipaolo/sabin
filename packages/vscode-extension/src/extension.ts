import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as path from 'path';
import { SabinWebviewProvider } from './providers/webviewProvider';
import { SabinFileWatcher } from './watchers/fileWatcher';
import { WorkspaceService, TaskWorkspace } from './services/workspaceService';
import { WorkspaceTreeProvider, WorkspaceNode } from './providers/workspaceProvider';
import { ticketFrom } from './services/ticket';
import { focusFolders } from './services/workspaceFolders';
import { noteFilename, seedFor } from './services/noteFiles';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  const service = new WorkspaceService(workspaceRoot);

  // Not a Sabin project: stay quiet rather than nag every window
  let sabinDir: string;
  try {
    sabinDir = await service.getSabinDir();
  } catch {
    return;
  }

  const board = new SabinWebviewProvider(context.extensionUri, service);
  const tree = new WorkspaceTreeProvider(service);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(SabinWebviewProvider.viewType, board),
    vscode.window.registerTreeDataProvider('sabin.workspaceView', tree)
  );

  const refresh = () => {
    board.refresh();
    tree.refresh();
  };

  context.subscriptions.push(
    new SabinFileWatcher(sabinDir, refresh),
    // Focus follows the branch, so a checkout in any root updates the view
    vscode.workspace.onDidChangeWorkspaceFolders(() => tree.refresh()),

    // A process dying writes no file, so the watcher never hears about it and
    // a killed agent's badge would sit there until something unrelated
    // changed. Re-reading when the window comes back into focus fixes it at
    // the only moment it matters - when you are looking at it - and costs no
    // timer.
    vscode.window.onDidChangeWindowState(state => {
      if (state.focused) refresh();
    })
  );

  registerCommands(context, service, tree, refresh);
  context.subscriptions.push(registerDeepLink(tree));

  // `sabin open` launches the editor and expects to land here, not wherever
  // the sidebar was left. Only on a cold start - a deep link handles the case
  // where the window was already up.
  if (vscode.workspace.getConfiguration('sabin').get<boolean>('revealOnStartup', true)) {
    void vscode.commands.executeCommand('sabin.workspaceView.focus');
  }
}

/**
 * vscode://angelodipaolo.sabin-vscode/focus?ticket=SABIN-0016
 *
 * How `sabin open` reaches a window that is already running. A URL rather
 * than a spawned process: the extension stays a reader and writer of Sabin
 * data, and the OS does the routing.
 */
function registerDeepLink(tree: WorkspaceTreeProvider): vscode.Disposable {
  return vscode.window.registerUriHandler({
    async handleUri(uri: vscode.Uri) {
      if (uri.path !== '/focus') return;

      await vscode.commands.executeCommand('sabin.workspaceView.focus');

      const ticket = new URLSearchParams(uri.query).get('ticket');
      if (ticket) await vscode.commands.executeCommand('sabin.focusTask', ticket);
    }
  });
}

/** Exit code `sabin jump` uses for "there is nothing to focus" */
const NO_SESSIONS = 3;

interface RunResult {
  ok: boolean;
  code: number | null;
  message: string;
}

function run(command: string, args: string[]): Promise<RunResult> {
  return new Promise(resolve => {
    execFile(command, args, (error, _stdout, stderr) => {
      if (!error) return resolve({ ok: true, code: 0, message: '' });
      const code = typeof (error as { code?: unknown }).code === 'number'
        ? (error as unknown as { code: number }).code
        : null;
      resolve({ ok: false, code, message: (stderr || error.message).trim() });
    });
  });
}

function registerCommands(
  context: vscode.ExtensionContext,
  service: WorkspaceService,
  tree: WorkspaceTreeProvider,
  refresh: () => void
): void {
  // Focusing still works without folder swapping, so nag once per session
  // rather than on every click
  let warnedAboutPlainWindow = false;

  const focusedOrWarn = (): TaskWorkspace | undefined => {
    const workspace = tree.focused();
    if (!workspace) vscode.window.showWarningMessage('No task is focused.');
    return workspace;
  };

  const register = (command: string, handler: (...args: any[]) => Promise<void> | void) =>
    context.subscriptions.push(vscode.commands.registerCommand(command, async (...args) => {
      try {
        await handler(...args);
      } catch (error) {
        vscode.window.showErrorMessage(`Sabin: ${error instanceof Error ? error.message : error}`);
      }
    }));

  /**
   * The VS Code → iTerm2 handoff, and the only thing this extension spawns.
   *
   * SABIN-0016 refused to let the extension launch agents and asked that any
   * reversal be deliberate rather than slipped in behind a button. This is
   * the deliberate version, and the line it draws is a capability one:
   * **`sabin jump` and `sabin term`, never `plan`, `implement` or `review`.**
   * Navigating to a terminal that already exists is not the same act as
   * starting an autonomous agent, and only the second one was refused.
   */
  register('sabin.openInITerm', async (arg?: WorkspaceNode | string) => {
    const target = ticketFrom(arg, () => focusedOrWarn()?.ticket);
    if (!target) return;

    const sabin = vscode.workspace.getConfiguration('sabin').get<string>('cliPath', 'sabin');

    // `--any` because a child process has no terminal to show a picker in:
    // without it, a ticket with two agents exits non-zero and we would open a
    // third tab instead of focusing one of them
    const jumped = await run(sabin, ['jump', target, '--any']);
    if (jumped.ok) return;

    // Exit 3 is specifically "nothing to focus" - anything else is a real
    // failure and opening a shell would paper over it
    if (jumped.code !== NO_SESSIONS) {
      vscode.window.showErrorMessage(
        `Sabin: could not reach iTerm2 for ${target}. ` +
        (jumped.message ? jumped.message : `Is \`${sabin}\` on PATH? Set sabin.cliPath if not.`)
      );
      return;
    }

    const opened = await run(sabin, ['term', target]);
    if (!opened.ok) {
      vscode.window.showErrorMessage(
        `Sabin: could not open a terminal for ${target}. ` +
        (opened.message || `Is \`${sabin}\` on PATH? Set sabin.cliPath if not.`)
      );
    }
  });

  register('sabin.refreshTasks', () => {
    service.invalidate();
    refresh();
  });

  register('sabin.newTask', async () => {
    const title = await vscode.window.showInputBox({
      prompt: 'Task title',
      placeHolder: 'Add telemetry to the upload path',
      validateInput: value => value.trim() ? undefined : 'Give the task a title'
    });
    if (!title) return;

    const suggested = await service.nextTaskId();
    const id = await vscode.window.showInputBox({
      prompt: 'Task ID - Enter to accept, or type an external one like JIRA-12345',
      value: suggested
    });
    if (id === undefined) return;

    const created = await service.createTask(title.trim(), id.trim() || suggested);
    refresh();
    await openDocument(created.taskFile);
  });

  register('sabin.focusTask', async (ticket?: string) => {
    const target = ticket ?? await pickTicket(service);
    if (!target) return;

    await tree.focus(target);
    const workspace = tree.find(target);
    if (!workspace) return;

    if (focusFolders(workspace) === 'unsupported' && !warnedAboutPlainWindow) {
      warnedAboutPlainWindow = true;
      void offerProjectWorkspace(service);
    }
  });

  register('sabin.unpinTask', () => tree.unpin());

  register('sabin.openProjectWorkspace', async () => {
    const target = await service.getCodeWorkspacePath();
    if (!target) {
      vscode.window.showWarningMessage('No Sabin workspace file found. Run `sabin link` in the project.');
      return;
    }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target));
  });

  register('sabin.openPrompt', async () => {
    const workspace = focusedOrWarn();
    if (!workspace) return;
    await service.ensureFiles(workspace);
    await openDocument(workspace.promptFile);
  });

  register('sabin.openTask', async (arg?: { ticket?: string }) => {
    const workspace = arg?.ticket ? tree.find(arg.ticket) : focusedOrWarn();
    if (workspace) await openDocument(workspace.taskFile);
  });

  register('sabin.openPlan', async (arg?: { ticket?: string }) => {
    const workspace = arg?.ticket ? tree.find(arg.ticket) : focusedOrWarn();
    if (!workspace) return;

    if (!workspace.planPath) {
      vscode.window.showInformationMessage(`${workspace.ticket} has no plan yet. Ask an agent: /sabin plan`);
      return;
    }
    await openDocument(workspace.planPath);
  });

  register('sabin.openWorktree', async (arg?: { ticket?: string }) => {
    const workspace = arg?.ticket ? tree.find(arg.ticket) : tree.focused();
    if (!workspace) return;

    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(workspace.worktreeDir),
      { forceNewWindow: true }
    );
  });

  // Copying is the whole point of these two: the ticket ID is what you paste
  // after `sabin implement`, and a note's path is what you paste into a shell
  // or hand to an agent. Retyping either was the reported friction.
  register('sabin.copyTicket', async (arg?: WorkspaceNode | string) => {
    const ticket = ticketFrom(arg, () => tree.focused()?.ticket);
    if (!ticket) {
      vscode.window.showWarningMessage('No task is focused.');
      return;
    }
    await vscode.env.clipboard.writeText(ticket);
    vscode.window.setStatusBarMessage(`Copied ${ticket}`, 3000);
  });

  register('sabin.copyPath', async (arg?: WorkspaceNode | { ticket?: string }) => {
    const node = arg as WorkspaceNode | undefined;
    const target =
      node?.filePath ??
      (arg && 'ticket' in arg && arg.ticket ? tree.find(arg.ticket)?.taskFile : undefined) ??
      node?.workspace?.notesDir ??
      tree.focused()?.notesDir;

    if (!target) {
      vscode.window.showWarningMessage('Nothing to copy a path for.');
      return;
    }
    await vscode.env.clipboard.writeText(target);
    vscode.window.setStatusBarMessage(`Copied ${target}`, 3000);
  });

  register('sabin.newNote', async () => {
    const workspace = focusedOrWarn();
    if (!workspace) return;

    const name = await vscode.window.showInputBox({
      prompt: `New note in ${workspace.name}`,
      placeHolder: 'research, schema.json, data.csv',
      validateInput: value =>
        value.trim().length === 0 ? 'Give the note a name' :
        /[/\\]/.test(value) ? 'Notes cannot contain a path separator' :
        undefined
    });
    if (!name) return;

    const filename = noteFilename(name);
    const target = vscode.Uri.file(path.join(workspace.notesDir, filename));

    await vscode.workspace.fs.createDirectory(vscode.Uri.file(workspace.notesDir));

    // Never clobber an existing note - just open it
    try {
      await vscode.workspace.fs.stat(target);
    } catch {
      await vscode.workspace.fs.writeFile(target, Buffer.from(seedFor(filename)));
    }

    await openDocument(target.fsPath);
    tree.refresh();
  });
}

async function openDocument(file: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument(file);
  await vscode.window.showTextDocument(document);
}

/**
 * Explain why folders did not swap, and offer the one-click fix
 */
async function offerProjectWorkspace(service: WorkspaceService): Promise<void> {
  const target = await service.getCodeWorkspacePath();

  const message = target
    ? 'Task focused. To also swap the Explorer to each task\'s code and notes, reopen this project as a Sabin workspace.'
    : 'Task focused. Folder swapping needs a Sabin workspace file - run `sabin link` in the project to create one.';

  const action = target ? await vscode.window.showInformationMessage(message, 'Reopen') : undefined;

  if (action === 'Reopen' && target) {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target));
  }
}

/**
 * Searchable by ID and title alike - the quick pick matches on both
 */
async function pickTicket(service: WorkspaceService): Promise<string | undefined> {
  const workspaces = await service.listWorkspaces();
  const active = workspaces.filter(w => w.status !== 'completed');

  const choice = await vscode.window.showQuickPick(
    active.map(w => ({
      label: w.ticket,
      description: w.title,
      detail: `${w.status.replace('_', ' ')}${w.planPath ? ' · plan' : ''}${w.branch ? ` · ${w.branch}` : ''}`
    })),
    { placeHolder: 'Focus a task', matchOnDescription: true }
  );

  return choice?.label;
}

export function deactivate(): void {}
