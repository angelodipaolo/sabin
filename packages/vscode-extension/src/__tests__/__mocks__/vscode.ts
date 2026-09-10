// Mock implementation of vscode module for testing
export const Uri = {
  file: (path: string) => ({ fsPath: path, path }),
  joinPath: (base: any, ...pathSegments: string[]) => ({
    fsPath: [base.fsPath, ...pathSegments].join('/'),
    path: [base.path, ...pathSegments].join('/')
  })
};

export const workspace = {
  workspaceFolders: [],
  fs: {
    createDirectory: jest.fn().mockResolvedValue(undefined),
    writeFile: jest.fn().mockResolvedValue(undefined),
    readDirectory: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined)
  },
  createFileSystemWatcher: jest.fn(() => ({
    onDidChange: jest.fn(),
    onDidCreate: jest.fn(),
    onDidDelete: jest.fn(),
    dispose: jest.fn()
  })),
  openTextDocument: jest.fn(),
  workspaceFile: undefined as any,
  updateWorkspaceFolders: jest.fn(),
  onDidChangeWorkspaceFolders: jest.fn()
};

export const window = {
  showInformationMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showQuickPick: jest.fn(),
  showInputBox: jest.fn(),
  showTextDocument: jest.fn(),
  setStatusBarMessage: jest.fn(),
  onDidChangeWindowState: jest.fn(() => ({ dispose: jest.fn() }))
};

export const commands = {
  executeCommand: jest.fn()
};

export const env = {
  clipboard: {
    writeText: jest.fn()
  }
};

export class EventEmitter<T> {
  private listeners: ((value: T) => void)[] = [];
  readonly event = (listener: (value: T) => void) => {
    this.listeners.push(listener);
    return { dispose: jest.fn() };
  };
  fire(value: T): void {
    for (const listener of this.listeners) listener(value);
  }
  dispose(): void {}
}

export class TreeItem {
  description?: string;
  tooltip?: any;
  iconPath?: any;
  contextValue?: string;
  resourceUri?: any;
  command?: any;
  constructor(public label: string, public collapsibleState?: number) {}
}

export class ThemeIcon {
  static readonly File = new ThemeIcon('file');
  static readonly Folder = new ThemeIcon('folder');
  constructor(public id: string) {}
}

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2
};

export const FileType = {
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64
};

export class RelativePattern {
  constructor(public base: any, public pattern: string) {}
}
