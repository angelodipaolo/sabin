import * as vscode from 'vscode';
import * as path from 'path';
import { AgentState, AgentActivity } from '@sabin/core';
import { WorkspaceService, TaskWorkspace } from '../services/workspaceService';

type NodeKind =
  | 'focused' | 'prompt' | 'note' | 'notesDir' | 'notesEmpty'
  | 'group' | 'task' | 'empty' | 'session';

/** Icon and wording per activity. Absent activity gets no row at all. */
const ACTIVITY: Record<AgentActivity, { icon: string; label: string }> = {
  waiting: { icon: 'bell-dot', label: 'waiting for you' },
  busy: { icon: 'loading~spin', label: 'busy' },
  idle: { icon: 'circle-outline', label: 'idle' }
};

export class WorkspaceNode extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly kind: NodeKind,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly workspace?: TaskWorkspace,
    public readonly filePath?: string
  ) {
    super(label, collapsibleState);
  }
}

const STATUS_ORDER = ['in_progress', 'review', 'ready', 'open', 'completed'];

/** Whatever needs you first */
const ORDER: Record<AgentActivity, number> = { waiting: 0, busy: 1, idle: 2 };

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'In progress',
  review: 'In review',
  ready: 'Ready',
  open: 'Open',
  completed: 'Completed'
};

/**
 * Tree showing the focused task's own files above the rest of the board.
 *
 * The focused task follows the checked-out branch unless it has been pinned
 * by clicking another task - a tree that drifts out of sync with what you are
 * looking at becomes a second thing to navigate rather than a replacement.
 */
export class WorkspaceTreeProvider implements vscode.TreeDataProvider<WorkspaceNode> {
  private changed = new vscode.EventEmitter<WorkspaceNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  private workspaces: TaskWorkspace[] = [];
  private states: AgentState[] = [];
  private focusedTicket: string | null = null;
  private pinned = false;

  constructor(private service: WorkspaceService) {}

  public refresh(): void {
    this.changed.fire(undefined);
  }

  public async focus(ticket: string, pin = true): Promise<void> {
    this.focusedTicket = ticket;
    this.pinned = pin;
    this.refresh();
  }

  public unpin(): void {
    this.pinned = false;
    this.refresh();
  }

  public isPinned(): boolean {
    return this.pinned;
  }

  public focused(): TaskWorkspace | undefined {
    return this.workspaces.find(w => w.ticket === this.focusedTicket);
  }

  public find(ticket: string): TaskWorkspace | undefined {
    return this.workspaces.find(w => w.ticket === ticket);
  }

  getTreeItem(element: WorkspaceNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: WorkspaceNode): Promise<WorkspaceNode[]> {
    if (!element) {
      return this.rootNodes();
    }

    if (element.kind === 'focused' && element.workspace) {
      return this.focusedChildren(element.workspace);
    }

    if (element.kind === 'group') {
      return this.taskNodes(element.label as string);
    }

    if (element.kind === 'notesDir' && element.filePath) {
      return this.directoryChildren(element.filePath);
    }

    return [];
  }

  private async rootNodes(): Promise<WorkspaceNode[]> {
    try {
      this.workspaces = await this.service.listWorkspaces();
      this.states = await this.service.agentStates();
    } catch (error) {
      return [new WorkspaceNode(`Could not read .sabin: ${error}`, 'empty', vscode.TreeItemCollapsibleState.None)];
    }

    if (this.workspaces.length === 0) {
      return [new WorkspaceNode('No tasks yet', 'empty', vscode.TreeItemCollapsibleState.None)];
    }

    // Branch wins unless the user explicitly clicked a different task
    if (!this.pinned) {
      const roots = (vscode.workspace.workspaceFolders ?? []).map(folder => folder.uri.fsPath);
      const fromBranch = await this.service.currentTicket(roots);
      if (fromBranch) this.focusedTicket = fromBranch;
    }

    const nodes: WorkspaceNode[] = [];
    const focused = this.focused();

    if (focused) {
      const node = new WorkspaceNode(
        focused.name,
        'focused',
        vscode.TreeItemCollapsibleState.Expanded,
        focused
      );
      node.description = `${STATUS_LABELS[focused.status] ?? focused.status}${this.pinned ? ' · pinned' : ''}`;
      node.tooltip = new vscode.MarkdownString(
        `**${focused.title}**\n\n` +
        `Branch: \`${focused.branch ?? '—'}\`\n\n` +
        `Worktree: \`${focused.worktreeDir}\``
      );
      node.iconPath = new vscode.ThemeIcon(this.pinned ? 'pinned' : 'target');
      node.contextValue = 'sabinFocused';
      nodes.push(node);
    }

    const present = new Set<string>(this.workspaces.map(w => w.status));
    for (const status of STATUS_ORDER) {
      if (!present.has(status)) continue;
      if (status === 'completed') continue;

      const group = new WorkspaceNode(
        STATUS_LABELS[status] ?? status,
        'group',
        vscode.TreeItemCollapsibleState.Expanded
      );
      group.contextValue = 'sabinGroup';
      nodes.push(group);
    }

    return nodes;
  }

  private async focusedChildren(workspace: TaskWorkspace): Promise<WorkspaceNode[]> {
    const nodes: WorkspaceNode[] = [];

    const prompt = new WorkspaceNode(
      path.basename(workspace.promptFile),
      'prompt',
      vscode.TreeItemCollapsibleState.None,
      workspace,
      workspace.promptFile
    );
    prompt.description = 'prompt scratchpad';
    prompt.contextValue = 'sabinNote';
    prompt.iconPath = new vscode.ThemeIcon('edit');
    prompt.command = openFile(workspace.promptFile);
    nodes.push(prompt);

    const task = new WorkspaceNode(
      path.basename(workspace.taskFile),
      'note',
      vscode.TreeItemCollapsibleState.None,
      workspace,
      workspace.taskFile
    );
    task.description = 'task';
    task.contextValue = 'sabinNote';
    task.iconPath = new vscode.ThemeIcon('checklist');
    task.command = openFile(workspace.taskFile);
    nodes.push(task);

    nodes.push(...this.sessionNodes(workspace));

    const notes = await this.service.notesFor(workspace);
    if (notes.length === 0) {
      const empty = new WorkspaceNode('No notes yet', 'notesEmpty', vscode.TreeItemCollapsibleState.None);
      empty.iconPath = new vscode.ThemeIcon('note');
      nodes.push(empty);
    } else {
      nodes.push(...notes.map(entry => entryNode(workspace, path.join(workspace.notesDir, entry.name), entry.isDirectory)));
    }

    return nodes;
  }

  /**
   * The ticket's agents, and what they are doing.
   *
   * Agents only - a plain shell writes no state, so it does not appear here.
   * `sabin sessions` and the ⌥Space picker are where the complete list lives;
   * what you want from the editor is which agent needs you.
   */
  private sessionNodes(workspace: TaskWorkspace): WorkspaceNode[] {
    return this.states
      .filter(state => state.ticket === workspace.ticket)
      .sort((a, b) => ORDER[a.activity] - ORDER[b.activity])
      .map(state => {
        const node = new WorkspaceNode(
          state.agent ?? 'agent',
          'session',
          vscode.TreeItemCollapsibleState.None,
          workspace
        );
        const badge = ACTIVITY[state.activity];
        node.description = badge.label;
        node.iconPath = new vscode.ThemeIcon(badge.icon);
        node.contextValue = 'sabinSession';
        node.tooltip = `${state.agent ?? 'agent'} · ${badge.label}`;
        node.command = {
          command: 'sabin.openInITerm',
          title: 'Open in iTerm2',
          arguments: [workspace.ticket]
        };
        return node;
      });
  }

  private async directoryChildren(dir: string): Promise<WorkspaceNode[]> {
    const entries = await this.service.listDirectory(dir);
    return entries.map(entry => entryNode(undefined, path.join(dir, entry.name), entry.isDirectory));
  }

  private taskNodes(groupLabel: string): WorkspaceNode[] {
    const status = Object.keys(STATUS_LABELS).find(key => STATUS_LABELS[key] === groupLabel) ?? groupLabel;

    return this.workspaces
      .filter(w => w.status === status)
      .sort((a, b) => a.ticket.localeCompare(b.ticket))
      .map(workspace => {
        const node = new WorkspaceNode(
          workspace.ticket,
          'task',
          vscode.TreeItemCollapsibleState.None,
          workspace
        );
        node.description = workspace.planPath ? `${workspace.title} · plan` : workspace.title;
        node.iconPath = new vscode.ThemeIcon(
          workspace.ticket === this.focusedTicket ? 'circle-filled' : 'circle-outline'
        );
        node.contextValue = 'sabinTask';
        node.command = {
          command: 'sabin.focusTask',
          title: 'Focus task',
          arguments: [workspace.ticket]
        };
        return node;
      });
  }
}

/**
 * Notes can be any text an agent reads - JSON, YAML, CSV, logs - so let the
 * user's file icon theme pick the icon rather than assuming markdown
 */
function entryNode(
  workspace: TaskWorkspace | undefined,
  filePath: string,
  isDirectory: boolean
): WorkspaceNode {
  const node = new WorkspaceNode(
    path.basename(filePath),
    isDirectory ? 'notesDir' : 'note',
    isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    workspace,
    filePath
  );

  node.resourceUri = vscode.Uri.file(filePath);
  node.contextValue = isDirectory ? 'sabinNotesDir' : 'sabinNote';

  if (isDirectory) {
    node.iconPath = vscode.ThemeIcon.Folder;
  } else {
    node.iconPath = vscode.ThemeIcon.File;
    node.command = openFile(filePath);
  }

  return node;
}

function openFile(filePath: string): vscode.Command {
  return {
    command: 'vscode.open',
    title: 'Open',
    arguments: [vscode.Uri.file(filePath)]
  };
}
