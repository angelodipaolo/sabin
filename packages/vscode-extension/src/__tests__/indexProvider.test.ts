import { IndexViewProvider, toCard } from '../providers/indexProvider';
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

describe('IndexViewProvider', () => {
  let provider: IndexViewProvider;
  let service: jest.Mocked<WorkspaceService>;
  let webview: any;
  let handler: (message: any) => Promise<void>;
  let dispose: () => void;
  const vscode = require('vscode');

  const view = () => ({
    webview,
    visible: true,
    onDidChangeVisibility: jest.fn(),
    onDidDispose: jest.fn((fn: () => void) => { dispose = fn; })
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    service = {
      listWorkspaces: jest.fn().mockResolvedValue([workspace()]),
      agentStates: jest.fn().mockResolvedValue([]),
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

    provider = new IndexViewProvider({ fsPath: '/ext', path: '/ext' } as any, service);
    provider.resolveWebviewView(view() as any);
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

  // Hiding the index behind the detail view disposes it. If the stale handle
  // survives, the board comes back empty on the second visit.
  it('drops the view handle when the webview is disposed', async () => {
    dispose();
    webview.postMessage.mockClear();

    provider.refresh();
    await flush();
    expect(webview.postMessage).not.toHaveBeenCalled();

    provider.resolveWebviewView(view() as any);
    await flush();
    expect(webview.postMessage).toHaveBeenCalled();
  });

  it('routes card, plan and terminal actions to the extension commands', async () => {
    await handler({ command: 'open', ticket: 'SABIN-0001' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('sabin.gotoTask', 'SABIN-0001');

    await handler({ command: 'openPlan', ticket: 'SABIN-0001' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('sabin.openPlan', 'SABIN-0001');

    await handler({ command: 'gotoAgent', ticket: 'SABIN-0001' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('sabin.gotoAgent', 'SABIN-0001');

    await handler({ command: 'openTerminal', ticket: 'SABIN-0001' });
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('sabin.openTerminal', 'SABIN-0001');

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
        branch: 'me/SABIN-0001-thing',
        activity: null,
        agents: 0
      });
    });
  });
});

function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

describe('toCard activity', () => {
  const task = {
    ticket: 'SABIN-0017',
    title: 'Worktree navigation',
    status: 'in_progress',
    slug: null,
    taskFile: '/s/tasks/open/SABIN-0017.md',
    notesDir: '/s/notes/SABIN-0017',
    promptFile: '/s/prompts/SABIN-0017.md',
    worktreeDir: '/w/SABIN-0017',
    branch: 'angelo/SABIN-0017',
    planPath: null
  } as any;

  const state = (ticket: string, activity: string) =>
    ({ sessionId: `${ticket}-${activity}`, ticket, activity, since: '2026-08-26T22:00:00.000Z' }) as any;

  it('has no activity when no hook has reported', () => {
    expect(toCard(task).activity).toBeNull();
    expect(toCard(task, []).agents).toBe(0);
  });

  it('takes the most urgent activity among the ticket agents', () => {
    const card = toCard(task, [state('SABIN-0017', 'idle'), state('SABIN-0017', 'waiting')]);

    expect(card.activity).toBe('waiting');
    expect(card.agents).toBe(2);
  });

  it('ignores agents belonging to other tickets', () => {
    expect(toCard(task, [state('SABIN-0020', 'waiting')]).activity).toBeNull();
  });
});
