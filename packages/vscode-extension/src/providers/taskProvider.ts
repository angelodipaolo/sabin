import * as vscode from 'vscode';
import * as path from 'path';
import { TaskService, Task } from '../services/taskService';

type TreeNode = TaskItem | StatusGroupItem;

export class TaskProvider implements vscode.TreeDataProvider<TreeNode> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeNode | undefined | null | void> = new vscode.EventEmitter<TreeNode | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeNode | undefined | null | void> = this._onDidChangeTreeData.event;
  private taskService: TaskService;
  private workspaceRoot: string;

  constructor(workspaceRoot: string, taskService: TaskService) {
    this.workspaceRoot = workspaceRoot;
    this.taskService = taskService;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeNode): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeNode): Thenable<TreeNode[]> {
    console.log('[Sabin Debug] taskProvider.getChildren called, element:', element ? element.constructor.name : 'root');
    if (!this.workspaceRoot) {
      vscode.window.showInformationMessage('No tasks in empty workspace');
      return Promise.resolve([]);
    }

    // Root level: return status groups only
    if (!element) {
      console.log('[Sabin Debug] Returning status groups for root');
      return Promise.resolve(this.getTaskItems());
    }

    // Status group level: return tasks for that status
    if (element instanceof StatusGroupItem) {
      return Promise.resolve(element.tasks.map(task => new TaskItem(task)));
    }

    // Task level: no children (leaf node)
    return Promise.resolve([]);
  }

  private async getTaskItems(): Promise<TreeNode[]> {
    const tasks = await this.taskService.getTasks();
    console.log('[Sabin Debug] getTaskItems found', tasks.length, 'tasks');

    const statusGroups: { [key: string]: Task[] } = {
      'open': [],
      'ready': [],
      'in_progress': [],
      'review': [],
      'completed': []
    };

    tasks.forEach(task => {
      if (statusGroups[task.status]) {
        statusGroups[task.status].push(task);
      }
    });

    const items: TreeNode[] = [];

    for (const [status, statusTasks] of Object.entries(statusGroups)) {
      if (statusTasks.length > 0) {
        items.push(new StatusGroupItem(status, statusTasks.length, statusTasks));
      }
    }

    return items;
  }
}

class StatusGroupItem extends vscode.TreeItem {
  constructor(
    public readonly status: string,
    public readonly count: number,
    public readonly tasks: Task[]
  ) {
    super(`${status.charAt(0).toUpperCase() + status.slice(1)} (${count})`, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'statusGroup';

    const iconMap: { [key: string]: string } = {
      'open': 'circle-outline',
      'ready': 'play',
      'in_progress': 'sync',
      'review': 'eye',
      'completed': 'check'
    };

    this.iconPath = new vscode.ThemeIcon(iconMap[status] || 'circle-outline');
  }
}

export class TaskItem extends vscode.TreeItem {
  constructor(
    public readonly task: Task
  ) {
    super(task.filename, vscode.TreeItemCollapsibleState.None);

    this.tooltip = task.title;
    this.description = task.title;
    this.contextValue = 'task';
    this.resourceUri = vscode.Uri.file(task.path);

    this.command = {
      command: 'sabin.openTask',
      title: 'Open Task',
      arguments: [this.resourceUri]
    };

    const iconMap: { [key: string]: string } = {
      'open': 'circle-outline',
      'ready': 'play-circle',
      'in_progress': 'sync~spin',
      'review': 'eye',
      'completed': 'check-all'
    };

    this.iconPath = new vscode.ThemeIcon(iconMap[task.status] || 'circle-outline');

    if (task.plan) {
      this.description = `${task.title} 📄`;
    }
  }
}
