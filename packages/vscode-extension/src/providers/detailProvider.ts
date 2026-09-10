import * as vscode from 'vscode';
import * as path from 'path';
import { AgentState, AgentActivity } from '@sabin/core';
import { WorkspaceService, TaskWorkspace } from '../services/workspaceService';

/**
 * What a row is, which is also what may be done to it.
 *
 * `prompt` and `taskFile` are deliberately distinct from `note`: both paths are
 * derived from the ticket, so renaming either would break every other thing
 * that resolves them. Only `note` and `notesDir` get rename and delete.
 */
export type NodeKind = 'prompt' | 'taskFile' | 'note' | 'notesDir' | 'notesEmpty' | 'session';

const CONTEXT_VALUE: Record<NodeKind, string> = {
  prompt: 'sabinPrompt',
  taskFile: 'sabinTaskFile',
  note: 'sabinNote',
  notesDir: 'sabinNotesDir',
  notesEmpty: 'sabinNotesEmpty',
  session: 'sabinSession'
};

/** Icon and wording per activity. Absent activity gets no row at all. */
const ACTIVITY: Record<AgentActivity, { icon: string; label: string }> = {
  waiting: { icon: 'bell-dot', label: 'waiting for you' },
  busy: { icon: 'loading~spin', label: 'busy' },
  idle: { icon: 'circle-outline', label: 'idle' }
};

/** Whatever needs you first */
const ORDER: Record<AgentActivity, number> = { waiting: 0, busy: 1, idle: 2 };

export const STATUS_LABELS: Record<string, string> = {
  in_progress: 'In progress',
  review: 'In review',
  ready: 'Ready',
  open: 'Open',
  completed: 'Completed'
};

export class DetailNode extends vscode.TreeItem {
  constructor(
    label: string,
    public readonly kind: NodeKind,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly workspace?: TaskWorkspace,
    public readonly filePath?: string
  ) {
    super(label, collapsibleState);
    this.contextValue = CONTEXT_VALUE[kind];
  }
}

/** Context keys the detail view's title-bar buttons condition on */
const HAS_WORKTREE = 'sabin.detailHasWorktree';
const HAS_AGENT = 'sabin.detailHasAgent';

/**
 * One ticket, and everything it owns: scratchpad, task file, live agents, notes.
 *
 * There is no index here and no notion of focus. Which ticket this shows is
 * whatever the user last navigated to from the index, held by the `Navigator`
 * and pushed in through `setTicket`. SABIN-0022 removed the branch-derived
 * focus this used to carry: in a worktree workflow the window's folders are
 * swapped in by the click itself, so the branch only ever "matched" a ticket
 * that had already been selected.
 */
export class DetailTreeProvider implements vscode.TreeDataProvider<DetailNode> {
  private changed = new vscode.EventEmitter<DetailNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;

  private ticket: string | null = null;
  private workspace: TaskWorkspace | undefined;
  private states: AgentState[] = [];
  private error: string | null = null;
  private view?: vscode.TreeView<DetailNode>;

  constructor(private service: WorkspaceService) {}

  /** The view is created in `activate`, so the title can only be set after */
  public attach(view: vscode.TreeView<DetailNode>): void {
    this.view = view;
    this.apply();
  }

  public current(): TaskWorkspace | undefined {
    return this.workspace;
  }

  public async setTicket(ticket: string | null): Promise<void> {
    this.ticket = ticket;
    await this.refresh();
  }

  public async refresh(): Promise<void> {
    await this.load();
    this.changed.fire(undefined);
  }

  getTreeItem(element: DetailNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: DetailNode): Promise<DetailNode[]> {
    if (element) {
      return element.kind === 'notesDir' && element.filePath
        ? this.directoryChildren(element.filePath)
        : [];
    }

    return this.workspace ? this.rootNodes(this.workspace) : [];
  }

  /**
   * Read the ticket once, then tell the view about it.
   *
   * Loading here rather than inside `getChildren` means the title and the
   * title-bar buttons stay correct even while the view is hidden behind the
   * index - `getChildren` is only called when something is on screen.
   */
  private async load(): Promise<void> {
    if (!this.ticket) {
      this.workspace = undefined;
      this.states = [];
      this.error = null;
      this.apply();
      return;
    }

    try {
      this.workspace = await this.service.find(this.ticket);
      this.states = await this.service.agentStates();
      this.error = null;
    } catch (error) {
      this.workspace = undefined;
      this.states = [];
      this.error = `Could not read .sabin: ${error}`;
    }

    this.apply();
  }

  private apply(): void {
    const agents = this.workspace
      ? this.states.filter(state => state.ticket === this.workspace!.ticket).length
      : 0;

    void vscode.commands.executeCommand('setContext', HAS_WORKTREE, Boolean(this.workspace?.branch));
    void vscode.commands.executeCommand('setContext', HAS_AGENT, agents > 0);

    if (!this.view) return;

    this.view.title = this.workspace?.ticket ?? 'Task';
    this.view.description = this.workspace ? STATUS_LABELS[this.workspace.status] : undefined;
    this.view.message = this.message();
  }

  private message(): string | undefined {
    if (this.error) return this.error;
    if (!this.ticket) return 'No task selected. Pick one from Tasks.';
    if (!this.workspace) return `${this.ticket} is not in this Sabin directory.`;
    return undefined;
  }

  private async rootNodes(workspace: TaskWorkspace): Promise<DetailNode[]> {
    const nodes: DetailNode[] = [];

    const prompt = new DetailNode(
      path.basename(workspace.promptFile),
      'prompt',
      vscode.TreeItemCollapsibleState.None,
      workspace,
      workspace.promptFile
    );
    prompt.description = 'prompt scratchpad';
    prompt.iconPath = new vscode.ThemeIcon('edit');
    prompt.command = openFile(workspace.promptFile);
    nodes.push(prompt);

    const task = new DetailNode(
      path.basename(workspace.taskFile),
      'taskFile',
      vscode.TreeItemCollapsibleState.None,
      workspace,
      workspace.taskFile
    );
    task.description = 'task';
    task.iconPath = new vscode.ThemeIcon('checklist');
    task.command = openFile(workspace.taskFile);
    nodes.push(task);

    nodes.push(...this.sessionNodes(workspace));

    const notes = await this.service.notesFor(workspace);
    if (notes.length === 0) {
      const empty = new DetailNode('No notes yet', 'notesEmpty', vscode.TreeItemCollapsibleState.None);
      empty.iconPath = new vscode.ThemeIcon('note');
      nodes.push(empty);
    } else {
      nodes.push(...notes.map(entry =>
        entryNode(workspace, path.join(workspace.notesDir, entry.name), entry.isDirectory)
      ));
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
  private sessionNodes(workspace: TaskWorkspace): DetailNode[] {
    return this.states
      .filter(state => state.ticket === workspace.ticket)
      .sort((a, b) => ORDER[a.activity] - ORDER[b.activity])
      .map(state => {
        const node = new DetailNode(
          state.agent ?? 'agent',
          'session',
          vscode.TreeItemCollapsibleState.None,
          workspace
        );
        const badge = ACTIVITY[state.activity];
        node.description = badge.label;
        node.iconPath = new vscode.ThemeIcon(badge.icon);
        node.tooltip = `${state.agent ?? 'agent'} · ${badge.label}`;
        node.command = {
          command: 'sabin.gotoAgent',
          title: 'Go to Agent',
          arguments: [workspace.ticket]
        };
        return node;
      });
  }

  private async directoryChildren(dir: string): Promise<DetailNode[]> {
    const entries = await this.service.listDirectory(dir);
    return entries.map(entry => entryNode(undefined, path.join(dir, entry.name), entry.isDirectory));
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
): DetailNode {
  const node = new DetailNode(
    path.basename(filePath),
    isDirectory ? 'notesDir' : 'note',
    isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    workspace,
    filePath
  );

  node.resourceUri = vscode.Uri.file(filePath);

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
