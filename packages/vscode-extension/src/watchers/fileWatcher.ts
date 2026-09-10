import * as vscode from 'vscode';

/**
 * Refresh the views when anything under the Sabin directory changes.
 *
 * One watcher over everything: task moves between status directories, edits
 * to a task, a plan appearing in a notes directory, a non-markdown note being
 * added. Events are debounced because a status change is a write plus a move.
 */
export class SabinFileWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher;
  private timer: NodeJS.Timeout | undefined;

  constructor(
    sabinDir: string,
    private onChange: () => void,
    private debounceMs = 300,
    private stateDebounceMs = 1000
  ) {
    this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(sabinDir, '**/*'));
    this.watcher.onDidChange(uri => this.schedule(uri));
    this.watcher.onDidCreate(uri => this.schedule(uri));
    this.watcher.onDidDelete(uri => this.schedule(uri));
  }

  private schedule(uri: vscode.Uri): void {
    // The CLI's lock directory comes and goes on every status write
    if (/[\\/]\.lock([\\/]|$)/.test(uri.fsPath)) return;

    // Agent activity changes several times a turn, on every agent at once.
    // At the tasks debounce the tree would rebuild all day; a second of lag
    // on a badge is not something anyone notices.
    const delay = /[\\/]state[\\/]/.test(uri.fsPath) ? this.stateDebounceMs : this.debounceMs;

    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.onChange();
    }, delay);
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.watcher.dispose();
  }
}
