import { SabinFileWatcher } from '../watchers/fileWatcher';

jest.mock('vscode');

describe('SabinFileWatcher', () => {
  let mockCallback: jest.Mock;
  let fileWatcher: SabinFileWatcher;
  let mockFileWatcherInstance: any;
  let mockDirectoryWatcherInstance: any;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    const vscode = require('vscode');

    // Setup workspace
    vscode.workspace.workspaceFolders = [{
      uri: { fsPath: '/test/workspace' },
      name: 'test',
      index: 0
    }];

    mockFileWatcherInstance = {
      onDidChange: jest.fn(),
      onDidCreate: jest.fn(),
      onDidDelete: jest.fn(),
      dispose: jest.fn()
    };

    mockDirectoryWatcherInstance = {
      onDidCreate: jest.fn(),
      onDidDelete: jest.fn(),
      dispose: jest.fn()
    };

    let callCount = 0;
    vscode.workspace.createFileSystemWatcher = jest.fn(() => {
      callCount++;
      return callCount === 1 ? mockFileWatcherInstance : mockDirectoryWatcherInstance;
    });

    mockCallback = jest.fn();
  });

  afterEach(() => {
    jest.useRealTimers();
    if (fileWatcher) {
      fileWatcher.dispose();
    }
  });

  describe('initialization', () => {
    it('should create file and directory watchers', () => {
      const vscode = require('vscode');
      fileWatcher = new SabinFileWatcher(mockCallback);

      expect(vscode.workspace.createFileSystemWatcher).toHaveBeenCalledTimes(2);
    });

    it('should throw error when no workspace folder found', () => {
      const vscode = require('vscode');
      vscode.workspace.workspaceFolders = undefined;

      expect(() => new SabinFileWatcher(mockCallback)).toThrow('No workspace folder found');
    });

    it('should register event handlers', () => {
      fileWatcher = new SabinFileWatcher(mockCallback);

      expect(mockFileWatcherInstance.onDidChange).toHaveBeenCalled();
      expect(mockFileWatcherInstance.onDidCreate).toHaveBeenCalled();
      expect(mockFileWatcherInstance.onDidDelete).toHaveBeenCalled();
      expect(mockDirectoryWatcherInstance.onDidCreate).toHaveBeenCalled();
      expect(mockDirectoryWatcherInstance.onDidDelete).toHaveBeenCalled();
    });
  });

  describe('debouncing behavior on file changes', () => {
    beforeEach(() => {
      fileWatcher = new SabinFileWatcher(mockCallback);
    });

    it('should debounce multiple rapid changes', () => {
      const onChange = mockFileWatcherInstance.onDidChange.mock.calls[0][0];

      // Trigger multiple changes
      onChange();
      onChange();
      onChange();

      // Callback should not be called yet
      expect(mockCallback).not.toHaveBeenCalled();

      // Fast forward time
      jest.advanceTimersByTime(500);

      // Callback should be called only once
      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should reset debounce timer on new change', () => {
      const onChange = mockFileWatcherInstance.onDidChange.mock.calls[0][0];

      onChange();
      jest.advanceTimersByTime(400);
      onChange(); // Reset timer
      jest.advanceTimersByTime(400);

      expect(mockCallback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(100);

      expect(mockCallback).toHaveBeenCalledTimes(1);
    });

    it('should handle create events with debouncing', () => {
      const onCreate = mockFileWatcherInstance.onDidCreate.mock.calls[0][0];

      onCreate();
      onCreate();

      expect(mockCallback).not.toHaveBeenCalled();

      jest.advanceTimersByTime(500);

      expect(mockCallback).toHaveBeenCalledTimes(1);
    });
  });

  describe('separate debounce timers for changes vs renames', () => {
    beforeEach(() => {
      fileWatcher = new SabinFileWatcher(mockCallback);
    });

    it('should use shorter debounce for renames', () => {
      const onChange = mockFileWatcherInstance.onDidChange.mock.calls[0][0];
      const onDelete = mockFileWatcherInstance.onDidDelete.mock.calls[0][0];

      onChange();
      onDelete();

      jest.advanceTimersByTime(300);

      // Rename callback should fire (300ms delay)
      expect(mockCallback).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(200);

      // Change callback should now fire (500ms total delay)
      expect(mockCallback).toHaveBeenCalledTimes(2);
    });

    it('should not interfere between change and rename timers', () => {
      const onChange = mockFileWatcherInstance.onDidChange.mock.calls[0][0];
      const onDirCreate = mockDirectoryWatcherInstance.onDidCreate.mock.calls[0][0];

      onChange(); // Start 500ms timer
      onDirCreate(); // Start 300ms timer immediately after

      // After 300ms, rename timer should fire
      jest.advanceTimersByTime(300);
      expect(mockCallback).toHaveBeenCalledTimes(1);

      // After another 200ms (500ms total), change timer should fire
      jest.advanceTimersByTime(200);
      expect(mockCallback).toHaveBeenCalledTimes(2);
    });
  });

  describe('disposal', () => {
    beforeEach(() => {
      fileWatcher = new SabinFileWatcher(mockCallback);
    });

    it('should clean up watchers and timers', () => {
      const onChange = mockFileWatcherInstance.onDidChange.mock.calls[0][0];
      const onDelete = mockFileWatcherInstance.onDidDelete.mock.calls[0][0];

      onChange();
      onDelete();

      fileWatcher.dispose();

      // Timers should be cleared
      jest.advanceTimersByTime(1000);
      expect(mockCallback).not.toHaveBeenCalled();

      // Watchers should be disposed
      expect(mockFileWatcherInstance.dispose).toHaveBeenCalled();
      expect(mockDirectoryWatcherInstance.dispose).toHaveBeenCalled();
    });

    it('should handle disposal without active timers', () => {
      expect(() => fileWatcher.dispose()).not.toThrow();
      expect(mockFileWatcherInstance.dispose).toHaveBeenCalled();
      expect(mockDirectoryWatcherInstance.dispose).toHaveBeenCalled();
    });
  });
});
