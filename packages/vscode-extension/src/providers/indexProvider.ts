import * as vscode from 'vscode';
import { AgentState, AgentActivity } from '@sabin/core';
import { TASK_STATUSES, TaskStatus, isTaskStatus } from '@sabin/core';
import { WorkspaceService, TaskWorkspace } from '../services/workspaceService';
import { INDEX_VIEW } from '../navigation';

/**
 * Messages the index sends back. Every action names a ticket; paths are
 * resolved here rather than trusted from the webview.
 */
type IndexMessage =
  | { command: 'refresh' }
  | { command: 'newTask' }
  | { command: 'open'; ticket: string }
  | { command: 'openPlan'; ticket: string }
  | { command: 'setStatus'; ticket: string; status: string }
  | { command: 'deleteTask'; ticket: string }
  | { command: 'copyPath'; ticket: string }
  | { command: 'gotoAgent'; ticket: string }
  | { command: 'openTerminal'; ticket: string }
  | { command: 'copyTicket'; ticket: string };

/**
 * Every uncompleted task at a glance, and the sidebar's home view.
 *
 * Clicking a card navigates to that ticket's detail view rather than doing
 * something in place - the card is one target, and the small buttons on it are
 * the exceptions that handle themselves.
 */
export class IndexViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = INDEX_VIEW;

  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly service: WorkspaceService
  ) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };
    webviewView.webview.html = this.html(webviewView.webview);

    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) this.refresh();
    });

    // A `when`-hidden view is disposed and resolved again on the way back.
    // Without this the stale handle outlives its webview, `refresh()` posts
    // into nothing, and the board comes back empty on the second visit.
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.view = undefined;
    });

    webviewView.webview.onDidReceiveMessage(async (message: IndexMessage) => {
      try {
        await this.handle(message);
      } catch (error) {
        vscode.window.showErrorMessage(`Sabin: ${error instanceof Error ? error.message : error}`);
      }
    });

    this.refresh();
  }

  public refresh(): void {
    if (!this.view) return;
    void Promise.all([this.service.listWorkspaces(), this.service.agentStates()]).then(
      ([tasks, states]) => {
        this.view?.webview.postMessage({
          command: 'tasks',
          tasks: tasks.map(workspace => toCard(workspace, states))
        });
      }
    );
  }

  private async handle(message: IndexMessage): Promise<void> {
    switch (message.command) {
      case 'refresh':
        this.refresh();
        return;
      case 'newTask':
        await vscode.commands.executeCommand('sabin.newTask');
        return;
      case 'open':
        await vscode.commands.executeCommand('sabin.gotoTask', message.ticket);
        return;
      case 'openPlan':
        await vscode.commands.executeCommand('sabin.openPlan', message.ticket);
        return;
      case 'setStatus':
        if (!isTaskStatus(message.status)) return;
        await this.service.setStatus(message.ticket, message.status);
        this.refresh();
        return;
      case 'deleteTask':
        await this.deleteTask(message.ticket);
        return;
      case 'copyTicket':
        await vscode.commands.executeCommand('sabin.copyTicket', message.ticket);
        return;
      // The ticket is the only thing taken from the page, and the commands
      // resolve everything else extension-side, as paths already are
      case 'gotoAgent':
        await vscode.commands.executeCommand('sabin.gotoAgent', message.ticket);
        return;
      case 'openTerminal':
        await vscode.commands.executeCommand('sabin.openTerminal', message.ticket);
        return;
      case 'copyPath': {
        const workspace = await this.service.find(message.ticket);
        if (workspace) {
          await vscode.env.clipboard.writeText(workspace.taskFile);
          vscode.window.setStatusBarMessage(`Copied ${workspace.taskFile}`, 3000);
        }
        return;
      }
    }
  }

  private async deleteTask(ticket: string): Promise<void> {
    const confirmation = await vscode.window.showWarningMessage(
      `Delete ${ticket}? Its notes are kept.`,
      { modal: true },
      'Delete'
    );
    if (confirmation !== 'Delete') return;

    await this.service.deleteTask(ticket);
    this.refresh();
  }

  private html(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'main.css'));
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', 'board.js'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${styleUri}" rel="stylesheet">
  <title>Sabin Tasks</title>
</head>
<body>
  <div id="board" data-statuses="${TASK_STATUSES.join(',')}"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export interface BoardCard {
  ticket: string;
  title: string;
  status: TaskStatus;
  hasPlan: boolean;
  hasWorktree: boolean;
  branch: string | null;
  /** The most urgent thing an agent on this ticket is doing, if any */
  activity: AgentActivity | null;
  agents: number;
}

/** Whatever needs you first */
const ACTIVITY_ORDER: Record<AgentActivity, number> = { waiting: 0, busy: 1, idle: 2 };

export function toCard(workspace: TaskWorkspace, states: AgentState[] = []): BoardCard {
  const mine = states
    .filter(state => state.ticket === workspace.ticket)
    .sort((a, b) => ACTIVITY_ORDER[a.activity] - ACTIVITY_ORDER[b.activity]);

  return {
    ticket: workspace.ticket,
    title: workspace.title,
    status: workspace.status,
    hasPlan: workspace.planPath !== null,
    hasWorktree: workspace.branch !== null,
    branch: workspace.branch,
    activity: mine[0]?.activity ?? null,
    agents: mine.length
  };
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
