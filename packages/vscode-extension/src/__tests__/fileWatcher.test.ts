import { SabinFileWatcher } from '../watchers/fileWatcher';

jest.mock('vscode');

describe('SabinFileWatcher', () => {
  let onChange: jest.Mock;
  let handlers: { change?: (uri: any) => void; create?: (uri: any) => void; delete?: (uri: any) => void };
  let watcherInstance: any;
  let watcher: SabinFileWatcher;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    const vscode = require('vscode');
    handlers = {};
    watcherInstance = {
      onDidChange: jest.fn(handler => { handlers.change = handler; }),
      onDidCreate: jest.fn(handler => { handlers.create = handler; }),
      onDidDelete: jest.fn(handler => { handlers.delete = handler; }),
      dispose: jest.fn()
    };
    vscode.workspace.createFileSystemWatcher = jest.fn(() => watcherInstance);

    onChange = jest.fn();
    watcher = new SabinFileWatcher('/notes/project/.sabin', onChange, 300);
  });

  afterEach(() => {
    watcher.dispose();
    jest.useRealTimers();
  });

  it('watches everything under the Sabin directory', () => {
    const vscode = require('vscode');
    const [pattern] = vscode.workspace.createFileSystemWatcher.mock.calls[0];
    expect(pattern.base).toBe('/notes/project/.sabin');
    expect(pattern.pattern).toBe('**/*');
  });

  it('debounces bursts of events into one refresh', () => {
    handlers.change!({ fsPath: '/notes/project/.sabin/tasks/open/SABIN-0001.md' });
    handlers.delete!({ fsPath: '/notes/project/.sabin/tasks/open/SABIN-0001.md' });
    handlers.create!({ fsPath: '/notes/project/.sabin/tasks/completed/SABIN-0001.md' });

    expect(onChange).not.toHaveBeenCalled();
    jest.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('refreshes for non-markdown notes too', () => {
    handlers.create!({ fsPath: '/notes/project/.sabin/notes/SABIN-0001-x/schema.json' });
    jest.advanceTimersByTime(300);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('ignores the CLI lock directory', () => {
    handlers.create!({ fsPath: '/notes/project/.sabin/.lock' });
    handlers.create!({ fsPath: '/notes/project/.sabin/.lock/owner' });
    jest.advanceTimersByTime(300);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('drops a pending refresh on dispose', () => {
    handlers.change!({ fsPath: '/notes/project/.sabin/tasks/open/SABIN-0001.md' });
    watcher.dispose();
    jest.advanceTimersByTime(300);
    expect(onChange).not.toHaveBeenCalled();
    expect(watcherInstance.dispose).toHaveBeenCalled();
  });
});
