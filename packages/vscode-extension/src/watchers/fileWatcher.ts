import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class SabinFileWatcher implements vscode.Disposable {
  private fileWatcher: vscode.FileSystemWatcher;
  private directoryWatcher: vscode.FileSystemWatcher;
  private debounceTimer: NodeJS.Timeout | undefined;
  private readonly debounceDelay = 500;
  private renameDebounceTimer: NodeJS.Timeout | undefined;
  private readonly renameDebounceDelay = 300;

  constructor(private onChangeCallback: () => void) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceRoot) {
      throw new Error('No workspace folder found');
    }

    // Resolve .sabin location
    const sabinDir = this.resolveSabinDir(workspaceRoot.uri.fsPath);

    // Watch for file changes
    const filePattern = new vscode.RelativePattern(
      sabinDir,
      '**/*.md'
    );

    this.fileWatcher = vscode.workspace.createFileSystemWatcher(filePattern);

    this.fileWatcher.onDidChange(() => this.handleChange());
    this.fileWatcher.onDidCreate(() => this.handleChange());
    this.fileWatcher.onDidDelete(() => this.handleRename());

    // Watch for directory changes (to catch moves between directories)
    const dirPattern = new vscode.RelativePattern(
      sabinDir,
      'tasks/**'
    );

    this.directoryWatcher = vscode.workspace.createFileSystemWatcher(dirPattern);

    // When files are created/deleted in directories, it indicates a move
    this.directoryWatcher.onDidCreate(() => this.handleRename());
    this.directoryWatcher.onDidDelete(() => this.handleRename());
  }

  private resolveSabinDir(workspaceRoot: string): string {
    const sabinPath = path.join(workspaceRoot, '.sabin');

    try {
      const stat = fs.statSync(sabinPath);

      if (stat.isFile()) {
        // Read link file
        const content = fs.readFileSync(sabinPath, 'utf8');
        const config = JSON.parse(content);
        if (config.sabinDir) {
          return path.resolve(workspaceRoot, config.sabinDir);
        }
      }
    } catch (error) {
      console.error('Failed to read .sabin:', error);
    }

    // Default to treating as directory
    return sabinPath;
  }

  private handleChange() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.onChangeCallback();
      this.debounceTimer = undefined;
    }, this.debounceDelay);
  }

  private handleRename() {
    // Use a separate, shorter debounce for renames to ensure quick updates
    if (this.renameDebounceTimer) {
      clearTimeout(this.renameDebounceTimer);
    }

    this.renameDebounceTimer = setTimeout(() => {
      this.onChangeCallback();
      this.renameDebounceTimer = undefined;
    }, this.renameDebounceDelay);
  }

  dispose() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    if (this.renameDebounceTimer) {
      clearTimeout(this.renameDebounceTimer);
    }
    this.fileWatcher.dispose();
    this.directoryWatcher.dispose();
  }
}