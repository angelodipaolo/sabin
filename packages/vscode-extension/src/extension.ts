import * as vscode from 'vscode';
import { execFile } from 'child_process';
import * as path from 'path';
import { TASK_STATUSES, TaskStatus } from '@sabin/core';
import { IndexViewProvider } from './providers/indexProvider';
import { DetailTreeProvider, DetailNode, STATUS_LABELS } from './providers/detailProvider';
import { Navigator, DETAIL_CONTEXT, DETAIL_VIEW, CONTAINER } from './navigation';
import { SabinFileWatcher } from './watchers/fileWatcher';
import { WorkspaceService, TaskWorkspace } from './services/workspaceService';
import { ticketFrom } from './services/ticket';
import { focusFolders } from './services/workspaceFolders';
import { noteFilename, noteTargetName, validateNoteName, seedFor } from './services/noteFiles';

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

  const index = new IndexViewProvider(context.extensionUri, service);
  const detail = new DetailTreeProvider(service);

  const detailView = vscode.window.createTreeView<DetailNode>(DETAIL_VIEW, {
    treeDataProvider: detail,
    showCollapseAll: true
  });
  detail.attach(detailView);

  const nav = new Navigator(detail);

  // The container opens on the index; nothing has been navigated to yet
  await vscode.commands.executeCommand('setContext', DETAIL_CONTEXT, false);

  context.subscriptions.push(
    detailView,
    vscode.window.registerWebviewViewProvider(IndexViewProvider.viewType, index)
  );

  const refresh = () => {
    index.refresh();
    void detail.refresh();
  };

  context.subscriptions.push(
    new SabinFileWatcher(sabinDir, refresh),
    // Folder names carry the focused ticket, so a swap is worth re-reading
    vscode.workspace.onDidChangeWorkspaceFolders(() => void detail.refresh()),

    // A process dying writes no file, so the watcher never hears about it and
    // a killed agent's badge would sit there until something unrelated
    // changed. Re-reading when the window comes back into focus fixes it at
    // the only moment it matters - when you are looking at it - and costs no
    // timer.
    vscode.window.onDidChangeWindowState(state => {
      if (state.focused) refresh();
    })
  );

  registerCommands(context, service, nav, detail, detailView, refresh);
  context.subscriptions.push(registerDeepLink());

  // `sabin open` launches the editor and expects to land here, not wherever
  // the sidebar was left. Only on a cold start - a deep link handles the case
  // where the window was already up.
  if (vscode.workspace.getConfiguration('sabin').get<boolean>('revealOnStartup', true)) {
    void vscode.commands.executeCommand(CONTAINER);
  }
}

/**
 * vscode://angelodipaolo.sabin-vscode/focus?ticket=SABIN-0016
 *
 * How `sabin open` reaches a window that is already running. A URL rather
 * than a spawned process: the extension stays a reader and writer of Sabin
 * data, and the OS does the routing. The path stays `/focus` because the CLI
 * builds it (`packages/cli/src/commands/open.ts`), whatever the commands
 * behind it are called.
 */
function registerDeepLink(): vscode.Disposable {
  return vscode.window.registerUriHandler({
    async handleUri(uri: vscode.Uri) {
      if (uri.path !== '/focus') return;

      await vscode.commands.executeCommand(CONTAINER);

      const ticket = new URLSearchParams(uri.query).get('ticket');
      await vscode.commands.executeCommand(ticket ? 'sabin.gotoTask' : 'sabin.showIndex', ticket);
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

function cliPath(): string {
  return vscode.workspace.getConfiguration('sabin').get<string>('cliPath', 'sabin');
}

function onPath(sabin: string): string {
  return `Is \`${sabin}\` on PATH? Set sabin.cliPath if not.`;
}

function registerCommands(
  context: vscode.ExtensionContext,
  service: WorkspaceService,
  nav: Navigator,
  detail: DetailTreeProvider,
  detailView: vscode.TreeView<DetailNode>,
  refresh: () => void
): void {
  // Navigating still works without folder swapping, so nag once per session
  // rather than on every click
  let warnedAboutPlainWindow = false;

  const register = (command: string, handler: (...args: any[]) => Promise<void> | void) =>
    context.subscriptions.push(vscode.commands.registerCommand(command, async (...args) => {
      try {
        await handler(...args);
      } catch (error) {
        vscode.window.showErrorMessage(`Sabin: ${error instanceof Error ? error.message : error}`);
      }
    }));

  /**
   * The ticket a command should act on: the one it was handed, else the one
   * the detail view is on, else whichever the user picks.
   *
   * The picker fallback is what makes ⌥⌘P and ⌥⌘L work from the index, where
   * nothing has been navigated to yet.
   */
  const ticketOrPick = async (arg?: unknown): Promise<string | undefined> =>
    ticketFrom(arg as any, () => nav.current()) ?? await pickTicket(service);

  const workspaceOrPick = async (arg?: unknown): Promise<TaskWorkspace | undefined> => {
    const ticket = await ticketOrPick(arg);
    if (!ticket) return undefined;

    const workspace = await service.find(ticket);
    if (!workspace) vscode.window.showWarningMessage(`${ticket} is not in this Sabin directory.`);
    return workspace;
  };

  /**
   * A row that may be renamed or deleted.
   *
   * The scratchpad and the task file are excluded on purpose: both paths are
   * derived from the ticket, so a rename would leave every other reader
   * looking somewhere else.
   */
  const noteNode = (arg?: DetailNode): DetailNode | undefined => {
    const node = arg ?? detailView.selection[0];
    if (!node?.filePath) return undefined;

    if (node.kind !== 'note' && node.kind !== 'notesDir') {
      vscode.window.showWarningMessage(
        `${node.label} cannot be renamed or deleted - its path is derived from the ticket.`
      );
      return undefined;
    }

    return node;
  };

  // -- Navigation ----------------------------------------------------------

  register('sabin.showIndex', () => nav.showIndex());

  /**
   * The one way into a task: navigate to its detail view, swap the Explorer
   * to its code and notes, and open the task file
   */
  register('sabin.gotoTask', async (arg?: string | { ticket?: string }) => {
    const target = ticketFrom(arg as any, () => undefined) ?? await pickTicket(service);
    if (!target) return;

    await nav.showDetail(target);

    const workspace = await service.find(target);
    if (!workspace) return;

    if (focusFolders(workspace) === 'unsupported' && !warnedAboutPlainWindow) {
      warnedAboutPlainWindow = true;
      void offerProjectWorkspace(service);
    }

    await openDocument(workspace.taskFile);
  });

  // -- Tasks ---------------------------------------------------------------

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
    await vscode.commands.executeCommand('sabin.gotoTask', created.ticket);
  });

  register('sabin.setStatus', async (arg?: unknown) => {
    const workspace = await workspaceOrPick(arg);
    if (!workspace) return;

    const choice = await vscode.window.showQuickPick(
      TASK_STATUSES.map(status => ({
        label: STATUS_LABELS[status] ?? status,
        description: status === workspace.status ? 'current' : undefined,
        status: status as TaskStatus
      })),
      { placeHolder: `Set status for ${workspace.ticket}` }
    );
    if (!choice || choice.status === workspace.status) return;

    await service.setStatus(workspace.ticket, choice.status);
    refresh();
  });

  register('sabin.openProjectWorkspace', async () => {
    const target = await service.getCodeWorkspacePath();
    if (!target) {
      vscode.window.showWarningMessage('No Sabin workspace file found. Run `sabin link` in the project.');
      return;
    }
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target));
  });

  // -- Files ---------------------------------------------------------------

  register('sabin.openPrompt', async (arg?: unknown) => {
    const workspace = await workspaceOrPick(arg);
    if (!workspace) return;
    await service.ensureFiles(workspace);
    await openDocument(workspace.promptFile);
  });

  register('sabin.openTask', async (arg?: unknown) => {
    const workspace = await workspaceOrPick(arg);
    if (workspace) await openDocument(workspace.taskFile);
  });

  register('sabin.openPlan', async (arg?: unknown) => {
    const workspace = await workspaceOrPick(arg);
    if (!workspace) return;

    if (!workspace.planPath) {
      vscode.window.showInformationMessage(`${workspace.ticket} has no plan yet. Ask an agent: /sabin plan`);
      return;
    }
    await openDocument(workspace.planPath);
  });

  register('sabin.openWorktree', async (arg?: unknown) => {
    const workspace = await workspaceOrPick(arg);
    if (!workspace) return;

    await vscode.commands.executeCommand(
      'vscode.openFolder',
      vscode.Uri.file(workspace.worktreeDir),
      { forceNewWindow: true }
    );
  });

  register('sabin.newNote', async (arg?: unknown) => {
    const workspace = await workspaceOrPick(arg);
    if (!workspace) return;

    const existing = (await service.listDirectory(workspace.notesDir)).map(entry => entry.name);

    const name = await vscode.window.showInputBox({
      prompt: `New note in ${workspace.name}`,
      placeHolder: 'research, schema.json, data.csv',
      validateInput: value => validateNoteName(value, existing)
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
    void detail.refresh();
  });

  /**
   * Rename and delete go through `vscode.workspace.fs` rather than `node:fs`
   * so the editor sees them as its own file operations: open editors follow a
   * rename, and a delete lands in the Trash where it can be undone.
   */
  register('sabin.renameNote', async (arg?: DetailNode) => {
    const node = noteNode(arg);
    if (!node?.filePath) return;

    const isDirectory = node.kind === 'notesDir';
    const dir = path.dirname(node.filePath);
    const current = path.basename(node.filePath);
    const siblings = (await service.listDirectory(dir))
      .map(entry => entry.name)
      .filter(entry => entry !== current);

    const extension = isDirectory ? '' : path.extname(current);
    const name = await vscode.window.showInputBox({
      prompt: `Rename ${current}`,
      value: current,
      // Preselect the stem only, as the Explorer's own rename does
      valueSelection: [0, current.length - extension.length],
      validateInput: value => validateNoteName(value, siblings, isDirectory)
    });
    if (!name) return;

    // Compare the name the note would actually land under, not the raw input:
    // typing `plan` over `plan.md` resolves back to `plan.md`, and renaming a
    // file onto itself is a no-op, not a `FileExists` error
    const target = path.join(dir, noteTargetName(name, isDirectory));
    if (target === node.filePath) return;

    await renameNote(node.filePath, target);
    void detail.refresh();
  });

  register('sabin.deleteNote', async (arg?: DetailNode) => {
    const node = noteNode(arg);
    if (!node?.filePath) return;

    const name = path.basename(node.filePath);
    const choice = await vscode.window.showWarningMessage(
      `Are you sure you want to delete '${name}'?`,
      { modal: true, detail: 'You can restore it from the Trash.' },
      'Move to Trash'
    );
    if (choice !== 'Move to Trash') return;

    await vscode.workspace.fs.delete(vscode.Uri.file(node.filePath), {
      recursive: true,
      useTrash: true
    });
    void detail.refresh();
  });

  register('sabin.revealNote', async (arg?: DetailNode) => {
    const target = (arg ?? detailView.selection[0])?.filePath;
    if (!target) return;
    await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(target));
  });

  // -- Clipboard -----------------------------------------------------------

  // Copying is the whole point of these two: the ticket ID is what you paste
  // after `sabin implement`, and a note's path is what you paste into a shell
  // or hand to an agent. Retyping either was the reported friction.
  register('sabin.copyTicket', async (arg?: DetailNode | string) => {
    const ticket = ticketFrom(arg as any, () => nav.current());
    if (!ticket) {
      vscode.window.showWarningMessage('No task is open.');
      return;
    }
    await vscode.env.clipboard.writeText(ticket);
    vscode.window.setStatusBarMessage(`Copied ${ticket}`, 3000);
  });

  register('sabin.copyPath', async (arg?: DetailNode | { ticket?: string }) => {
    const node = arg as DetailNode | undefined;
    const target =
      node?.filePath ??
      (arg && 'ticket' in arg && arg.ticket ? (await service.find(arg.ticket))?.taskFile : undefined) ??
      detail.current()?.notesDir;

    if (!target) {
      vscode.window.showWarningMessage('Nothing to copy a path for.');
      return;
    }
    await vscode.env.clipboard.writeText(target);
    vscode.window.setStatusBarMessage(`Copied ${target}`, 3000);
  });

  // -- iTerm2 --------------------------------------------------------------

  /**
   * The VS Code → iTerm2 handoff, and the only thing this extension spawns.
   *
   * SABIN-0016 refused to let the extension launch agents and asked that any
   * reversal be deliberate rather than slipped in behind a button. This is
   * the deliberate version, and the line it draws is a capability one:
   * **`sabin jump` and `sabin term`, never `plan`, `implement` or `review`.**
   * Navigating to a terminal that already exists is not the same act as
   * starting an autonomous agent, and only the second one was refused.
   *
   * SABIN-0022 split them apart. One button that jumped to an agent and
   * silently opened a shell when there was none meant "give me a shell in the
   * worktree" was a thing you could not ask for.
   */
  register('sabin.gotoAgent', async (arg?: DetailNode | string) => {
    // `ticketOrPick`, not `ticketFrom`: from the command palette on a cold
    // window there is nothing open, and swallowing the keystroke is worse than
    // asking which ticket
    const target = await ticketOrPick(arg);
    if (!target) return;

    const sabin = cliPath();

    // `--any` because a child process has no terminal to show a picker in:
    // without it, a ticket with two agents exits non-zero and we would be told
    // there is nothing to focus
    const jumped = await run(sabin, ['jump', target, '--any']);
    if (jumped.ok) return;

    // Exit 3 is specifically "nothing to focus" - report it rather than
    // papering over it with a shell the user did not ask for
    if (jumped.code === NO_SESSIONS) {
      const action = await vscode.window.showInformationMessage(
        `No agent is running for ${target}.`,
        'Open Terminal'
      );
      if (action === 'Open Terminal') {
        await vscode.commands.executeCommand('sabin.openTerminal', target);
      }
      return;
    }

    vscode.window.showErrorMessage(
      `Sabin: could not reach iTerm2 for ${target}. ` + (jumped.message || onPath(sabin))
    );
  });

  register('sabin.openTerminal', async (arg?: DetailNode | string) => {
    const target = await ticketOrPick(arg);
    if (!target) return;

    const sabin = cliPath();
    const opened = await run(sabin, ['term', target]);
    if (!opened.ok) {
      vscode.window.showErrorMessage(
        `Sabin: could not open a terminal for ${target}. ` + (opened.message || onPath(sabin))
      );
    }
  });
}

/**
 * Move a note, including the case-only move.
 *
 * `plan.md` → `Plan.md` is the same file on a case-insensitive filesystem -
 * which is the one this runs on - so `overwrite: false` sees the destination
 * already sitting there and refuses. Going via a name that exists under
 * neither spelling is what an editor does, and it costs one extra call in the
 * only case that needs it.
 */
async function renameNote(from: string, to: string): Promise<void> {
  const source = vscode.Uri.file(from);
  const destination = vscode.Uri.file(to);

  if (from.toLowerCase() !== to.toLowerCase()) {
    await vscode.workspace.fs.rename(source, destination, { overwrite: false });
    return;
  }

  const staging = vscode.Uri.file(`${to}.sabin-rename`);
  await vscode.workspace.fs.rename(source, staging, { overwrite: false });
  await vscode.workspace.fs.rename(staging, destination, { overwrite: false });
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
    ? 'Task opened. To also swap the Explorer to each task\'s code and notes, reopen this project as a Sabin workspace.'
    : 'Task opened. Folder swapping needs a Sabin workspace file - run `sabin link` in the project to create one.';

  const action = target ? await vscode.window.showInformationMessage(message, 'Reopen') : undefined;

  if (action === 'Reopen' && target) {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target));
  }
}

/**
 * Live search over every uncompleted task.
 *
 * The filter sees the ID, the title, the slug, the branch and the status,
 * because any of the five is a thing you might half-remember about a ticket
 * you are trying to get back to.
 */
async function pickTicket(service: WorkspaceService): Promise<string | undefined> {
  const workspaces = await service.listWorkspaces();
  const active = workspaces.filter(w => w.status !== 'completed');

  const choice = await vscode.window.showQuickPick(
    active.map(w => ({
      label: w.ticket,
      description: w.title,
      detail: [
        w.slug,
        w.branch,
        STATUS_LABELS[w.status] ?? w.status,
        w.planPath ? 'plan' : null
      ].filter(Boolean).join(' · ')
    })),
    { placeHolder: 'Go to task', matchOnDescription: true, matchOnDetail: true }
  );

  return choice?.label;
}

export function deactivate(): void {}
