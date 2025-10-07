import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TaskService } from '../services/taskService';

export class SabinWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'sabin.tasksView';

  private _view?: vscode.WebviewView;
  private taskService: TaskService;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    taskService: TaskService
  ) {
    this.taskService = taskService;
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

    // Refresh when webview becomes visible
    webviewView.onDidChangeVisibility(() => {
      if (webviewView.visible) {
        this.refresh();
      }
    });

    webviewView.webview.onDidReceiveMessage(async (data) => {
      console.log('[Sabin Debug] webviewProvider - Received message:', data);
      try {
        switch (data.command) {
          case 'showCreateTaskDialog':
            console.log('[Sabin Debug] webviewProvider - Executing sabin.newTask command');
            await vscode.commands.executeCommand('sabin.newTask');
            console.log('[Sabin Debug] webviewProvider - Command executed successfully');
            break;
          case 'showUpdateStatusDialog':
            await this.showUpdateStatusDialog(data.taskId, data.currentStatus);
            break;
          case 'createTask':
            await this.createTask(data.payload);
            break;
          case 'updateStatus':
            await this.updateTaskStatus(data.taskId, data.status);
            break;
          case 'openPlan':
            await this.openPlan(data.planPath);
            break;
          case 'openTask':
            await this.openTask(data.taskPath);
            break;
          case 'deleteTask':
            await this.deleteTask(data.taskId, data.taskPath);
            break;
          case 'copyTaskPath':
            await this.copyTaskPath(data.taskPath);
            break;
          case 'refreshTasks':
            this.refresh();
            break;
          case 'openCompletedView':
            await this.openCompletedView();
            break;
        }
      } catch (error) {
        console.error('[Sabin Debug] webviewProvider - Error handling message:', error);
        vscode.window.showErrorMessage(`Sabin error: ${error}`);
      }
    });

    this.refresh();
  }

  public refresh() {
    if (this._view) {
      this.updateWebviewContent();
    }
  }

  private async updateWebviewContent() {
    if (!this._view) {
      return;
    }

    const tasks = await this.taskService.getTasks();
    this._view.webview.postMessage({
      command: 'updateTasks',
      tasks: tasks
    });
  }

  private async createTask(payload: any) {
    console.log('[Sabin Debug] webviewProvider.createTask called with payload:', payload);
    try {
      const filePath = await this.taskService.createTask(payload.title, payload.description, payload.taskNumber);
      const filename = path.basename(filePath);
      vscode.window.showInformationMessage(`Created task: ${filename}`);

      // Delay refresh to ensure file operations complete
      await new Promise(resolve => setTimeout(resolve, 200));
      this.refresh();
    } catch (error) {
      console.error('[Sabin Debug] Error creating task:', error);
      throw error;
    }
  }

  private async showUpdateStatusDialog(taskId: string, currentStatus: string) {
    const statuses = ['open', 'ready', 'in_progress', 'review', 'completed'];
    const newStatus = await vscode.window.showQuickPick(statuses, {
      placeHolder: `Current status: ${currentStatus}. Select new status:`
    });

    if (newStatus) {
      await this.updateTaskStatus(taskId, newStatus);
    }
  }

  private async updateTaskStatus(taskId: string, newStatus: string) {
    try {
      await this.taskService.updateTaskStatus(taskId, newStatus);
      vscode.window.showInformationMessage(`Updated ${taskId} status to: ${newStatus}`);

      // Delay refresh to ensure file operations complete
      await new Promise(resolve => setTimeout(resolve, 200));
      this.refresh();
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update status: ${error}`);
      throw error;
    }
  }

  private async openPlan(planPath: string) {
    if (!planPath) {
      return;
    }

    const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceRoot) {
      return;
    }

    const fullPath = path.join(workspaceRoot, planPath);
    if (fs.existsSync(fullPath)) {
      const document = await vscode.workspace.openTextDocument(fullPath);
      await vscode.window.showTextDocument(document);
    } else {
      vscode.window.showErrorMessage(`Plan file not found: ${planPath}`);
    }
  }

  private async openTask(taskPath: string) {
    if (!taskPath) {
      return;
    }

    if (fs.existsSync(taskPath)) {
      const document = await vscode.workspace.openTextDocument(taskPath);
      await vscode.window.showTextDocument(document);
    } else {
      vscode.window.showErrorMessage(`Task file not found: ${taskPath}`);
    }
  }

  private async deleteTask(taskId: string, taskPath: string) {
    const confirmation = await vscode.window.showWarningMessage(
      `Are you sure you want to delete ${taskId}?`,
      { modal: true },
      'Delete'
    );

    if (confirmation === 'Delete') {
      try {
        await this.taskService.deleteTask(taskPath);
        vscode.window.showInformationMessage(`Deleted task: ${taskId}`);

        // Delay refresh to ensure file operations complete
        await new Promise(resolve => setTimeout(resolve, 200));
        this.refresh();
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to delete task: ${error}`);
      }
    }
  }

  private async copyTaskPath(taskPath: string) {
    if (!taskPath) {
      vscode.window.showErrorMessage('No task path provided');
      return;
    }

    try {
      await vscode.env.clipboard.writeText(taskPath);
      vscode.window.showInformationMessage(`Copied path to clipboard: ${taskPath}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to copy path: ${error}`);
    }
  }

  private async openCompletedView() {
    // This is now handled in the webview itself
    // No backend action needed
  }

  private getHtmlForWebview(webview: vscode.Webview) {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.css'));

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
        <div id="app">
          <div id="tasks-container" class="tickets-grid"></div>
        </div>

        <script nonce="${nonce}">
          console.log('[Sabin Debug] webview - Script loading...');
          const vscode = acquireVsCodeApi();
          console.log('[Sabin Debug] webview - vscode API acquired:', typeof vscode);

          function updateStatus(taskId, currentStatus) {
            vscode.postMessage({
              command: 'showUpdateStatusDialog',
              taskId: taskId,
              currentStatus: currentStatus
            });
          }

          function openPlan(planPath) {
            vscode.postMessage({
              command: 'openPlan',
              planPath: planPath
            });
          }

          function openTask(taskPath) {
            vscode.postMessage({
              command: 'openTask',
              taskPath: taskPath
            });
          }

          function deleteTask(taskId, taskPath) {
            vscode.postMessage({
              command: 'deleteTask',
              taskId: taskId,
              taskPath: taskPath
            });
          }

          function copyTaskPath(taskPath) {
            vscode.postMessage({
              command: 'copyTaskPath',
              taskPath: taskPath
            });
          }

          function formatStatus(status) {
            return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          }

          // Track collapsed state per status column
          const collapsedColumns = new Set();
          let showingCompletedView = false;

          function renderTasks(tasks) {
            const container = document.getElementById('tasks-container');

            const grouped = {};
            tasks.forEach(task => {
              if (!grouped[task.status]) {
                grouped[task.status] = [];
              }
              grouped[task.status].push(task);
            });

            let html = '';

            // If showing completed view, only show completed tasks
            if (showingCompletedView) {
              html += '<div class="completed-view-header">';
              html += '<button class="back-button" id="back-to-board">← Back to Board</button>';
              html += '<h2>Completed Tasks</h2>';
              html += '</div>';

              if (grouped['completed'] && grouped['completed'].length > 0) {
                html += '<div class="status-column full-width">';
                html += '<div class="tickets-list">';

                grouped['completed'].forEach(task => {
                  html += '<div class="ticket-card" data-task-id="' + task.id + '">';
                  html += '<div class="ticket-header">';
                  html += '<div class="ticket-id-section">';
                  html += '<span class="ticket-number">' + task.id + '</span>';
                  if (task.plan) {
                    html += '<button class="plan-label" data-plan="' + task.plan + '" title="View plan">';
                    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
                    html += '</button>';
                  }
                  html += '</div>';
                  html += '<div class="header-actions">';
                  html += '<div class="secondary-actions">';
                  html += '<button class="action-icon copy-icon" data-task-path="' + task.path + '" title="Copy task"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>';
                  html += '<button class="action-icon delete-icon" data-task-id="' + task.id + '" data-task-path="' + task.path + '" title="Delete task"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>';
                  html += '</div>';
                  html += '<div class="status-dropdown-container">';
                  html += '<button class="status-badge status-' + task.status + '" data-task-id="' + task.id + '" title="Change status">';
                  html += formatStatus(task.status).toUpperCase() + ' ▾';
                  html += '</button>';
                  html += '<div class="status-dropdown" data-task-id="' + task.id + '">';
                  html += '<div class="status-option" data-status="open" data-task-id="' + task.id + '"><span class="status-badge status-open">OPEN</span></div>';
                  html += '<div class="status-option" data-status="ready" data-task-id="' + task.id + '"><span class="status-badge status-ready">READY</span></div>';
                  html += '<div class="status-option" data-status="in_progress" data-task-id="' + task.id + '"><span class="status-badge status-in_progress">IN PROGRESS</span></div>';
                  html += '<div class="status-option" data-status="review" data-task-id="' + task.id + '"><span class="status-badge status-review">REVIEW</span></div>';
                  html += '<div class="status-option" data-status="completed" data-task-id="' + task.id + '"><span class="status-badge status-completed">COMPLETED</span></div>';
                  html += '</div>';
                  html += '</div>';
                  html += '</div>';
                  html += '</div>';
                  html += '<h4 data-task-path="' + task.path + '" style="cursor: pointer;">' + (task.title || task.id) + '</h4>';
                  html += '</div>';
                });

                html += '</div></div>';
              } else {
                html += '<p>No completed tasks found</p>';
              }

              container.innerHTML = html;
              return;
            }

            // Regular board view
            ['open', 'ready', 'in_progress', 'review'].forEach(status => {
              if (grouped[status] && grouped[status].length > 0) {
                const isCollapsed = collapsedColumns.has(status);
                html += '<div class="status-column">';
                html += '<h3 class="status-header clickable" data-status="' + status + '" title="Click to collapse/expand">' + formatStatus(status) + ' (' + grouped[status].length + ')';
                html += '<span class="collapse-indicator">' + (isCollapsed ? ' ▶' : ' ▼') + '</span>';
                html += '</h3>';
                html += '<div class="tickets-list' + (isCollapsed ? ' collapsed' : '') + '" data-status="' + status + '">';

                grouped[status].forEach(task => {
                  html += '<div class="ticket-card" data-task-id="' + task.id + '">';
                  html += '<div class="ticket-header">';
                  html += '<div class="ticket-id-section">';
                  html += '<span class="ticket-number">' + task.id + '</span>';
                  if (task.plan) {
                    html += '<button class="plan-label" data-plan="' + task.plan + '" title="View plan">';
                    html += '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
                    html += '</button>';
                  }
                  html += '</div>';
                  html += '<div class="header-actions">';
                  html += '<div class="secondary-actions">';
                  html += '<button class="action-icon copy-icon" data-task-path="' + task.path + '" title="Copy task"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button>';
                  html += '<button class="action-icon delete-icon" data-task-id="' + task.id + '" data-task-path="' + task.path + '" title="Delete task"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></button>';
                  html += '</div>';
                  html += '<div class="status-dropdown-container">';
                  html += '<button class="status-badge status-' + task.status + '" data-task-id="' + task.id + '" title="Change status">';
                  html += formatStatus(task.status).toUpperCase() + ' ▾';
                  html += '</button>';
                  html += '<div class="status-dropdown" data-task-id="' + task.id + '">';
                  html += '<div class="status-option" data-status="open" data-task-id="' + task.id + '"><span class="status-badge status-open">OPEN</span></div>';
                  html += '<div class="status-option" data-status="ready" data-task-id="' + task.id + '"><span class="status-badge status-ready">READY</span></div>';
                  html += '<div class="status-option" data-status="in_progress" data-task-id="' + task.id + '"><span class="status-badge status-in_progress">IN PROGRESS</span></div>';
                  html += '<div class="status-option" data-status="review" data-task-id="' + task.id + '"><span class="status-badge status-review">REVIEW</span></div>';
                  html += '<div class="status-option" data-status="completed" data-task-id="' + task.id + '"><span class="status-badge status-completed">COMPLETED</span></div>';
                  html += '</div>';
                  html += '</div>';
                  html += '</div>';
                  html += '</div>';
                  html += '<h4 data-task-path="' + task.path + '" style="cursor: pointer;">' + (task.title || task.id) + '</h4>';
                  html += '</div>';
                });

                html += '</div></div>';
              }
            });

            // Add completed link if there are completed tasks
            if (grouped['completed'] && grouped['completed'].length > 0) {
              html += '<div class="status-column">';
              html += '<h3 class="status-header completed-link" title="Click to view completed tasks">';
              html += '<a href="#" id="view-completed-link">Completed (' + grouped['completed'].length + ')</a>';
              html += '</h3>';
              html += '</div>';
            }

            container.innerHTML = html || '<p>No tasks found</p>';
          }

          window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
              case 'updateTasks':
                window.lastTasksMessage = message;
                renderTasks(message.tasks);
                break;
            }
          });

          function toggleColumn(status) {
            if (collapsedColumns.has(status)) {
              collapsedColumns.delete(status);
            } else {
              collapsedColumns.add(status);
            }
            // Re-render with updated collapse state
            const lastMessage = window.lastTasksMessage;
            if (lastMessage) {
              renderTasks(lastMessage.tasks);
            }
          }

          function viewCompletedTasks() {
            showingCompletedView = true;
            const lastMessage = window.lastTasksMessage;
            if (lastMessage) {
              renderTasks(lastMessage.tasks);
            }
          }

          function backToBoard() {
            showingCompletedView = false;
            const lastMessage = window.lastTasksMessage;
            if (lastMessage) {
              renderTasks(lastMessage.tasks);
            }
          }

          // Event delegation for dynamically created task elements
          document.getElementById('tasks-container').addEventListener('click', (e) => {
            const target = e.target;

            // Check if clicked on back button
            if (target.id === 'back-to-board') {
              e.preventDefault();
              backToBoard();
              return;
            }

            // Check if clicked on status header to collapse/expand
            if (target.classList.contains('status-header') && target.classList.contains('clickable')) {
              e.stopPropagation();
              const status = target.getAttribute('data-status');
              toggleColumn(status);
              return;
            }

            // Check if clicked on completed link
            if (target.id === 'view-completed-link') {
              e.preventDefault();
              viewCompletedTasks();
              return;
            }

            // Check if clicked on status badge to toggle dropdown
            if (target.classList.contains('status-badge') && target.tagName === 'BUTTON') {
              e.stopPropagation();
              const taskId = target.getAttribute('data-task-id');
              toggleStatusDropdown(taskId);
              return;
            }

            // Check if clicked on status option in dropdown
            if (target.classList.contains('status-option') || target.closest('.status-option')) {
              const option = target.classList.contains('status-option') ? target : target.closest('.status-option');
              const taskId = option.getAttribute('data-task-id');
              const newStatus = option.getAttribute('data-status');
              vscode.postMessage({
                command: 'updateStatus',
                taskId: taskId,
                status: newStatus
              });
              closeAllDropdowns();
              return;
            }

            // Check if clicked on copy icon
            const copyButton = target.closest('.copy-icon');
            if (copyButton) {
              const taskPath = copyButton.getAttribute('data-task-path');
              copyTaskPath(taskPath);
              return;
            }

            // Check if clicked on delete icon
            const deleteButton = target.closest('.delete-icon');
            if (deleteButton) {
              const taskId = deleteButton.getAttribute('data-task-id');
              const taskPath = deleteButton.getAttribute('data-task-path');
              deleteTask(taskId, taskPath);
              return;
            }

            // Check if clicked on task title (to open task file)
            if (target.tagName === 'H4' && target.hasAttribute('data-task-path')) {
              const taskPath = target.getAttribute('data-task-path');
              openTask(taskPath);
            }

            // Check if clicked on plan label
            const planButton = target.closest('.plan-label');
            if (planButton) {
              const planPath = planButton.getAttribute('data-plan');
              openPlan(planPath);
              return;
            }
          });

          // Close dropdowns when clicking outside
          document.addEventListener('click', (e) => {
            if (!e.target.closest('.status-dropdown-container')) {
              closeAllDropdowns();
            }
          });

          function toggleStatusDropdown(taskId) {
            const allDropdowns = document.querySelectorAll('.status-dropdown');
            const targetDropdown = document.querySelector('.status-dropdown[data-task-id="' + taskId + '"]');

            // Close all other dropdowns
            allDropdowns.forEach(dropdown => {
              if (dropdown !== targetDropdown) {
                dropdown.classList.remove('show');
              }
            });

            // Toggle target dropdown
            if (targetDropdown) {
              targetDropdown.classList.toggle('show');
            }
          }

          function closeAllDropdowns() {
            document.querySelectorAll('.status-dropdown').forEach(dropdown => {
              dropdown.classList.remove('show');
            });
          }

          window.addEventListener('load', () => {
            console.log('[Sabin Debug] webview - Window loaded');
          });

          vscode.postMessage({ command: 'refreshTasks' });
        </script>
      </body>
      </html>`;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
