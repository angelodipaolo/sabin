import * as vscode from 'vscode';
import * as path from 'path';
import { SabinWebviewProvider } from './providers/webviewProvider';
import { SabinFileWatcher } from './watchers/fileWatcher';
import { WorkspaceService, TaskWorkspace } from './services/workspaceService';
import { WorkspaceTreeProvider } from './providers/workspaceProvider';
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
    vscode.workspace.onDidChangeWorkspaceFolders(() => tree.refresh())
  );

  registerCommands(context, service, tree, refresh);
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
