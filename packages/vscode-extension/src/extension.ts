import * as vscode from 'vscode';
import * as path from 'path';
import { SabinWebviewProvider } from './providers/webviewProvider';
import { SabinFileWatcher } from './watchers/fileWatcher';
import { TaskService } from './services/taskService';

export function activate(context: vscode.ExtensionContext) {
  console.log('Sabin extension is now active!');

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
  if (!workspaceRoot) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }

  // Initialize shared task service
  const taskService = TaskService.getInstance(workspaceRoot);

  const provider = new SabinWebviewProvider(context.extensionUri, taskService);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      'sabin.tasksView',
      provider
    )
  );

  const fileWatcher = new SabinFileWatcher(() => {
    provider.refresh();
  });
  context.subscriptions.push(fileWatcher);

  context.subscriptions.push(
    vscode.commands.registerCommand('sabin.newTask', async () => {
      console.log('[Sabin Debug] extension - sabin.newTask command invoked');
      try {
        await createNewTask(taskService);
        // Small delay to ensure file operations complete
        await new Promise(resolve => setTimeout(resolve, 200));
        provider.refresh();
        console.log('[Sabin Debug] extension - task creation completed successfully');
      } catch (error) {
        console.error('[Sabin Debug] extension - Error in sabin.newTask:', error);
        vscode.window.showErrorMessage(`Failed to create task: ${error}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('sabin.refreshTasks', () => {
      provider.refresh();
      vscode.window.showInformationMessage('Tasks refreshed');
    })
  );
}

async function createNewTask(taskService: TaskService) {
  console.log('[Sabin Debug] createNewTask called');

  const panel = vscode.window.createWebviewPanel(
    'newTask',
    'New Task',
    vscode.ViewColumn.One,
    {
      enableScripts: true
    }
  );

  const nextTaskNumber = await taskService.getNextTaskNumber();
  const projectPrefix = await taskService.getProjectPrefix();
  panel.webview.html = getNewTaskHtml(panel.webview, nextTaskNumber, projectPrefix);

  // Handle messages from the webview
  const messageDisposable = panel.webview.onDidReceiveMessage(
    async (message) => {
      switch (message.command) {
        case 'createTask':
          try {
            const filePath = await taskService.createTask(message.title, undefined, message.taskNumber);
            const filename = path.basename(filePath);

            const document = await vscode.workspace.openTextDocument(filePath);
            await vscode.window.showTextDocument(document);

            vscode.window.showInformationMessage(`Created task: ${filename}`);
            panel.dispose();
          } catch (error) {
            vscode.window.showErrorMessage(`Failed to create task: ${error}`);
          }
          break;
        case 'cancel':
          panel.dispose();
          break;
      }
    }
  );

  panel.onDidDispose(() => {
    messageDisposable.dispose();
  });
}

function getNewTaskHtml(webview: vscode.Webview, nextTaskNumber: string, projectPrefix: string): string {
  const nonce = getNonce();
  const defaultTaskId = `${projectPrefix}-${nextTaskNumber}`;

  return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>New Task</title>
      <style>
        * {
          box-sizing: border-box;
          margin: 0;
          padding: 0;
        }

        body {
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size);
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
          padding: 0;
          margin: 0;
        }

        .dialog {
          background-color: var(--vscode-sideBar-background);
          border: 1px solid var(--vscode-widget-border);
          border-radius: 6px;
          max-width: 600px;
          margin: 40px auto;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
        }

        .dialog-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px 20px;
          border-bottom: 1px solid var(--vscode-widget-border);
        }

        .dialog-title {
          font-size: 18px;
          font-weight: 600;
          color: var(--vscode-foreground);
        }

        .close-btn {
          background: none;
          border: none;
          color: var(--vscode-foreground);
          font-size: 24px;
          cursor: pointer;
          padding: 0;
          width: 32px;
          height: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          opacity: 0.8;
        }

        .close-btn:hover {
          background-color: var(--vscode-toolbar-hoverBackground);
          opacity: 1;
        }

        .dialog-body {
          padding: 20px;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-label {
          display: block;
          margin-bottom: 8px;
          font-weight: 500;
          color: var(--vscode-foreground);
        }

        .required {
          color: #f85149;
          margin-left: 4px;
        }

        .optional {
          color: var(--vscode-descriptionForeground);
          font-weight: normal;
          font-size: 0.9em;
          margin-left: 4px;
        }

        input[type="text"],
        textarea {
          width: 100%;
          padding: 10px 12px;
          background-color: var(--vscode-input-background);
          color: var(--vscode-input-foreground);
          border: 1px solid var(--vscode-input-border);
          border-radius: 4px;
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size);
        }

        input[type="text"]:focus,
        textarea:focus {
          outline: none;
          border-color: var(--vscode-focusBorder);
          box-shadow: 0 0 0 1px var(--vscode-focusBorder);
        }

        textarea {
          resize: vertical;
          min-height: 120px;
        }

        input[type="text"]::placeholder,
        textarea::placeholder {
          color: var(--vscode-input-placeholderForeground);
        }

        .dialog-footer {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          padding: 16px 20px;
          border-top: 1px solid var(--vscode-widget-border);
        }

        button {
          padding: 8px 16px;
          border-radius: 4px;
          font-family: var(--vscode-font-family);
          font-size: var(--vscode-font-size);
          cursor: pointer;
          border: none;
          font-weight: 500;
        }

        .btn-cancel {
          background-color: transparent;
          color: var(--vscode-foreground);
          border: 1px solid var(--vscode-button-border);
        }

        .btn-cancel:hover {
          background-color: var(--vscode-button-hoverBackground);
        }

        .btn-create {
          background-color: #1f6feb;
          color: #ffffff;
        }

        .btn-create:hover:not(:disabled) {
          background-color: #1a5fd9;
        }

        .btn-create:disabled {
          opacity: 0.5;
          cursor: not-allowed;
          background-color: #1f6feb;
        }
      </style>
    </head>
    <body>
      <div class="dialog">
        <div class="dialog-header">
          <h1 class="dialog-title">New Task</h1>
          <button class="close-btn" id="close-btn" title="Close">×</button>
        </div>
        <div class="dialog-body">
          <form id="task-form">
            <div class="form-group">
              <label class="form-label" for="task-number">
                Task ID<span class="optional">(auto-generated or custom)</span>
              </label>
              <input
                type="text"
                id="task-number"
                placeholder="${defaultTaskId}"
                value="${defaultTaskId}"
              />
            </div>
            <div class="form-group">
              <label class="form-label" for="title">
                Title<span class="required">*</span>
              </label>
              <input
                type="text"
                id="title"
                placeholder="Enter task title"
                autofocus
              />
            </div>
          </form>
        </div>
        <div class="dialog-footer">
          <button type="button" class="btn-cancel" id="cancel-btn">Cancel</button>
          <button type="button" class="btn-create" id="create-btn" disabled>Create Task</button>
        </div>
      </div>

      <script nonce="${nonce}">
        const vscode = acquireVsCodeApi();
        const taskNumberInput = document.getElementById('task-number');
        const titleInput = document.getElementById('title');
        const createBtn = document.getElementById('create-btn');
        const cancelBtn = document.getElementById('cancel-btn');
        const closeBtn = document.getElementById('close-btn');

        // Enable/disable create button based on title input
        titleInput.addEventListener('input', () => {
          createBtn.disabled = !titleInput.value.trim();
        });

        // Handle form submission
        createBtn.addEventListener('click', () => {
          const taskNumber = taskNumberInput.value.trim();
          const title = titleInput.value.trim();

          if (title) {
            vscode.postMessage({
              command: 'createTask',
              title: title,
              taskNumber: taskNumber || undefined
            });
          }
        });

        // Handle Enter key in title field
        titleInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && titleInput.value.trim()) {
            e.preventDefault();
            createBtn.click();
          }
        });

        // Handle cancel
        cancelBtn.addEventListener('click', () => {
          vscode.postMessage({ command: 'cancel' });
        });

        closeBtn.addEventListener('click', () => {
          vscode.postMessage({ command: 'cancel' });
        });

        // Handle Escape key
        document.addEventListener('keydown', (e) => {
          if (e.key === 'Escape') {
            vscode.postMessage({ command: 'cancel' });
          }
        });
      </script>
    </body>
    </html>`;
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

export function deactivate() {}
