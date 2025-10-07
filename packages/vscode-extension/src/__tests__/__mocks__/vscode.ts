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
  openTextDocument: jest.fn()
};

export const window = {
  showInformationMessage: jest.fn(),
  showErrorMessage: jest.fn(),
  showWarningMessage: jest.fn(),
  showQuickPick: jest.fn(),
  showTextDocument: jest.fn()
};

export const commands = {
  executeCommand: jest.fn()
};

export const env = {
  clipboard: {
    writeText: jest.fn()
  }
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
