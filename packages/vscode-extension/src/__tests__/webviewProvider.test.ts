import { SabinWebviewProvider } from '../providers/webviewProvider';
import { TaskService } from '../services/taskService';

jest.mock('vscode');
jest.mock('fs');

describe('SabinWebviewProvider', () => {
  let provider: SabinWebviewProvider;
  let mockTaskService: jest.Mocked<TaskService>;
  let mockWebviewView: any;
  let mockWebview: any;
  let messageHandler: (data: any) => Promise<void>;

  beforeEach(() => {
    jest.clearAllMocks();

    const vscode = require('vscode');
    const fs = require('fs');

    // Mock TaskService
    mockTaskService = {
      getTasks: jest.fn().mockResolvedValue([
        {
          id: 'TASK-0001',
          status: 'open',
          title: 'Test Task',
          content: 'Content',
          path: '/path/to/task.md',
          filename: 'TASK-0001.md'
        }
      ]),
      createTask: jest.fn().mockResolvedValue('/path/to/TASK-0002.md'),
      updateTaskStatus: jest.fn().mockResolvedValue(undefined),
      deleteTask: jest.fn().mockResolvedValue(undefined)
    } as any;

    // Mock webview
    mockWebview = {
      html: '',
      options: {},
      onDidReceiveMessage: jest.fn((handler) => {
        messageHandler = handler;
      }),
      postMessage: jest.fn(),
      asWebviewUri: jest.fn((uri) => uri)
    };

    // Mock webview view
    mockWebviewView = {
      webview: mockWebview,
      visible: true,
      onDidChangeVisibility: jest.fn()
    };

    // Configure vscode workspace
    vscode.workspace.workspaceFolders = [{
      uri: { fsPath: '/workspace' },
      name: 'test',
      index: 0
    }];

    // Mock fs
    fs.existsSync = jest.fn().mockReturnValue(true);

    const extensionUri = { fsPath: '/extension', path: '/extension' };
    provider = new SabinWebviewProvider(extensionUri as any, mockTaskService);
  });

  describe('resolveWebviewView', () => {
    it('should initialize webview with correct options', () => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      expect(mockWebviewView.webview.options).toEqual({
        enableScripts: true,
        localResourceRoots: [expect.objectContaining({ fsPath: '/extension' })]
      });
    });

    it('should set HTML content on initialization', () => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      expect(mockWebview.html).toBeTruthy();
      expect(mockWebview.html).toContain('<!DOCTYPE html>');
    });

    it('should register message handler', () => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      expect(mockWebview.onDidReceiveMessage).toHaveBeenCalled();
    });

    it('should register visibility change handler', () => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      expect(mockWebviewView.onDidChangeVisibility).toHaveBeenCalled();
    });

    it('should refresh tasks on initialization', () => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      expect(mockTaskService.getTasks).toHaveBeenCalled();
    });
  });

  describe('message handling - createTask', () => {
    beforeEach(() => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    });

    it('should create task with provided payload', async () => {
      await messageHandler({
        command: 'createTask',
        payload: {
          title: 'New Task',
          description: 'Description',
          taskNumber: undefined
        }
      });

      // Wait for the delayed refresh
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(mockTaskService.createTask).toHaveBeenCalledWith(
        'New Task',
        'Description',
        undefined
      );
    });

    it('should show success message after creating task', async () => {
      const vscode = require('vscode');

      await messageHandler({
        command: 'createTask',
        payload: { title: 'New Task' }
      });

      // Wait for the delayed refresh
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Created task: TASK-0002.md'
      );
    });

    it('should refresh after creating task', async () => {
      await messageHandler({
        command: 'createTask',
        payload: { title: 'New Task' }
      });

      // Wait for the delayed refresh
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(mockTaskService.getTasks).toHaveBeenCalledTimes(2); // Once on init, once on refresh
    });
  });

  describe('message handling - updateStatus', () => {
    beforeEach(() => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    });

    it('should update task status', async () => {
      await messageHandler({
        command: 'updateStatus',
        taskId: 'TASK-0001',
        status: 'completed'
      });

      // Wait for the delayed refresh
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(mockTaskService.updateTaskStatus).toHaveBeenCalledWith(
        'TASK-0001',
        'completed'
      );
    });

    it('should show success message after updating status', async () => {
      const vscode = require('vscode');

      await messageHandler({
        command: 'updateStatus',
        taskId: 'TASK-0001',
        status: 'ready'
      });

      // Wait for the delayed refresh
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
        'Updated TASK-0001 status to: ready'
      );
    });

    it('should show error on update failure', async () => {
      const vscode = require('vscode');
      mockTaskService.updateTaskStatus.mockRejectedValue(new Error('Update failed'));

      // Error is caught and shown to user
      await messageHandler({
        command: 'updateStatus',
        taskId: 'TASK-0001',
        status: 'ready'
      });

      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });
  });

  describe('message handling - showUpdateStatusDialog', () => {
    beforeEach(() => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    });

    it('should show quick pick with status options', async () => {
      const vscode = require('vscode');
      vscode.window.showQuickPick.mockResolvedValue('ready');

      await messageHandler({
        command: 'showUpdateStatusDialog',
        taskId: 'TASK-0001',
        currentStatus: 'open'
      });

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        ['open', 'ready', 'in_progress', 'review', 'completed'],
        { placeHolder: 'Current status: open. Select new status:' }
      );
    });

    it('should update status when user selects option', async () => {
      const vscode = require('vscode');
      vscode.window.showQuickPick.mockResolvedValue('completed');

      await messageHandler({
        command: 'showUpdateStatusDialog',
        taskId: 'TASK-0001',
        currentStatus: 'review'
      });

      // Wait for the delayed refresh
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(mockTaskService.updateTaskStatus).toHaveBeenCalledWith(
        'TASK-0001',
        'completed'
      );
    });

    it('should not update status when user cancels', async () => {
      const vscode = require('vscode');
      vscode.window.showQuickPick.mockResolvedValue(undefined);

      await messageHandler({
        command: 'showUpdateStatusDialog',
        taskId: 'TASK-0001',
        currentStatus: 'open'
      });

      expect(mockTaskService.updateTaskStatus).not.toHaveBeenCalled();
    });
  });

  describe('message handling - deleteTask', () => {
    beforeEach(() => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    });

    it('should show confirmation dialog', async () => {
      const vscode = require('vscode');
      vscode.window.showWarningMessage.mockResolvedValue(undefined);

      await messageHandler({
        command: 'deleteTask',
        taskId: 'TASK-0001',
        taskPath: '/path/to/task.md'
      });

      expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
        'Are you sure you want to delete TASK-0001?',
        { modal: true },
        'Delete'
      );
    });

    it('should delete task when confirmed', async () => {
      const vscode = require('vscode');
      vscode.window.showWarningMessage.mockResolvedValue('Delete');

      await messageHandler({
        command: 'deleteTask',
        taskId: 'TASK-0001',
        taskPath: '/path/to/task.md'
      });

      // Wait for the delayed refresh
      await new Promise(resolve => setTimeout(resolve, 250));

      expect(mockTaskService.deleteTask).toHaveBeenCalledWith('/path/to/task.md');
    });

    it('should not delete task when cancelled', async () => {
      const vscode = require('vscode');
      vscode.window.showWarningMessage.mockResolvedValue(undefined);

      await messageHandler({
        command: 'deleteTask',
        taskId: 'TASK-0001',
        taskPath: '/path/to/task.md'
      });

      expect(mockTaskService.deleteTask).not.toHaveBeenCalled();
    });
  });

  describe('message handling - refreshTasks', () => {
    it('should refresh tasks on command', async () => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
      mockTaskService.getTasks.mockClear();

      await messageHandler({ command: 'refreshTasks' });

      expect(mockTaskService.getTasks).toHaveBeenCalled();
    });
  });

  describe('message handling - showCreateTaskDialog', () => {
    it('should execute sabin.newTask command', async () => {
      const vscode = require('vscode');
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);

      await messageHandler({ command: 'showCreateTaskDialog' });

      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('sabin.newTask');
    });
  });

  describe('refresh', () => {
    it('should update webview content when view is available', async () => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
      mockWebview.postMessage.mockClear();

      provider.refresh();
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(mockWebview.postMessage).toHaveBeenCalledWith({
        command: 'updateTasks',
        tasks: expect.any(Array)
      });
    });

    it('should not crash when view is not available', () => {
      expect(() => provider.refresh()).not.toThrow();
    });
  });

  describe('visibility change', () => {
    it('should refresh when webview becomes visible', () => {
      let visibilityHandler: () => void;
      mockWebviewView.onDidChangeVisibility.mockImplementation((handler: () => void) => {
        visibilityHandler = handler;
      });

      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
      mockTaskService.getTasks.mockClear();

      mockWebviewView.visible = true;
      visibilityHandler!();

      expect(mockTaskService.getTasks).toHaveBeenCalled();
    });

    it('should not refresh when webview is not visible', () => {
      let visibilityHandler: () => void;
      mockWebviewView.onDidChangeVisibility.mockImplementation((handler: () => void) => {
        visibilityHandler = handler;
      });

      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
      mockTaskService.getTasks.mockClear();

      mockWebviewView.visible = false;
      visibilityHandler!();

      expect(mockTaskService.getTasks).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      provider.resolveWebviewView(mockWebviewView, {} as any, {} as any);
    });

    it('should handle errors during message processing', async () => {
      const vscode = require('vscode');
      mockTaskService.createTask.mockRejectedValue(new Error('Creation failed'));

      // Error is caught and shown to user, doesn't propagate
      await messageHandler({
        command: 'createTask',
        payload: { title: 'Test' }
      });

      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });
  });
});
