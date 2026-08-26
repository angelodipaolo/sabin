import { SabinWebviewProvider, toCard } from '../providers/webviewProvider';
import { WorkspaceService, TaskWorkspace } from '../services/workspaceService';

jest.mock('vscode');

const workspace = (overrides: Partial<TaskWorkspace> = {}): TaskWorkspace => ({
  ticket: 'SABIN-0001',
  name: 'SABIN-0001-thing',
  title: 'Do the <thing>',
  status: 'open',
  slug: 'thing',
  taskFile: '/sabin/tasks/open/SABIN-0001.md',
  notesDir: '/sabin/notes/SABIN-0001-thing',
  promptFile: '/sabin/prompts/SABIN-0001-thing.md',
  worktreeDir: '/repo-worktrees/SABIN-0001-thing',
  branch: null,
  planPath: null,
  ...overrides
});

describe('SabinWebviewProvider', () => {
  let provider: SabinWebviewProvider;
  let service: jest.Mocked<WorkspaceService>;
  let webview: any;
  let handler: (message: any) => Promise<void>;
  const vscode = require('vscode');

  beforeEach(async () => {
    jest.clearAllMocks();

    service = {
      listWorkspaces: jest.fn().mockResolvedValue([workspace()]),
      find: jest.fn().mockResolvedValue(workspace()),
      setStatus: jest.fn().mockResolvedValue(undefined),
      deleteTask: jest.fn().mockResolvedValue(undefined)
    } as any;

    webview = {
      html: '',
      options: {},
      cspSource: 'vscode-resource:',
      onDidReceiveMessage: jest.fn(fn => { handler = fn; }),
      postMessage: jest.fn(),
      asWebviewUri: jest.fn(uri => uri.fsPath)
    };

    provider = new SabinWebviewProvider({ fsPath: '/ext', path: '/ext' } as any, service);
    provider.resolveWebviewView({ webview, visible: true, onDidChangeVisibility: jest.fn() } as any);
    await flush();
  });

  it('renders a CSP-restricted page that loads the board script', () => {
    expect(webview.options.enableScripts).toBe(true);
    expect(webview.html).toContain('Content-Security-Policy');
    expect(webview.html).toContain('/ext/media/board.js');
    expect(webview.html).toContain('data-statuses="open,ready,in_progress,review,completed"');
  });

  it('posts the task cards on resolve and on refresh', async () => {
    expect(webview.postMessage).toHaveBeenCalledWith({
      command: 'tasks',
      tasks: [toCard(workspace())]
    });

    webview.postMessage.mockClear();
    await handler({ command: 'refresh' });
    await flush();
    expect(webview.postMessage).toHaveBeenCalledTimes(1);
  });

  it('routes focus, open and plan actions to the extension commands', async () => {
    await handler({ command: 'focus', ticket: 'SABIN-0001' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('sabin.focusTask', 'SABIN-0001');

    await handler({ command: 'openTask', ticket: 'SABIN-0001' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('sabin.openTask', { ticket: 'SABIN-0001' });

    await handler({ command: 'openPlan', ticket: 'SABIN-0001' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('sabin.openPlan', { ticket: 'SABIN-0001' });

    await handler({ command: 'newTask' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('sabin.newTask');
  });

  it('changes status through the service and refreshes', async () => {
    webview.postMessage.mockClear();
    await handler({ command: 'setStatus', ticket: 'SABIN-0001', status: 'review' });
    await flush();

    expect(service.setStatus).toHaveBeenCalledWith('SABIN-0001', 'review');
    expect(webview.postMessage).toHaveBeenCalled();
  });

  it('ignores an unknown status', async () => {
    await handler({ command: 'setStatus', ticket: 'SABIN-0001', status: 'bogus' });
    expect(service.setStatus).not.toHaveBeenCalled();
  });

  it('deletes only after confirmation', async () => {
    vscode.window.showWarningMessage.mockResolvedValueOnce(undefined);
    await handler({ command: 'deleteTask', ticket: 'SABIN-0001' });
    expect(service.deleteTask).not.toHaveBeenCalled();

    vscode.window.showWarningMessage.mockResolvedValueOnce('Delete');
    await handler({ command: 'deleteTask', ticket: 'SABIN-0001' });
    expect(service.deleteTask).toHaveBeenCalledWith('SABIN-0001');
  });

  it('copies the task path resolved by the service, not one sent by the page', async () => {
    await handler({ command: 'copyPath', ticket: 'SABIN-0001' });
    expect(vscode.env.clipboard.writeText).toHaveBeenCalledWith('/sabin/tasks/open/SABIN-0001.md');
  });

  it('surfaces service errors instead of swallowing them', async () => {
    service.setStatus.mockRejectedValueOnce(new Error('Task not found: SABIN-0001'));
    await handler({ command: 'setStatus', ticket: 'SABIN-0001', status: 'ready' });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Sabin: Task not found: SABIN-0001');
  });

  describe('toCard', () => {
    it('sends only what the board needs', () => {
      const card = toCard(workspace({ planPath: '/sabin/notes/x/plan.md', branch: 'me/SABIN-0001-thing' }));
      expect(card).toEqual({
        ticket: 'SABIN-0001',
        title: 'Do the <thing>',
        status: 'open',
        hasPlan: true,
        hasWorktree: true,
        branch: 'me/SABIN-0001-thing'
      });
    });
  });
});

function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}
