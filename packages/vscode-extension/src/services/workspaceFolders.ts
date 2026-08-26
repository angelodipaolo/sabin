import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { TaskWorkspace } from './workspaceService';

const CODE_SUFFIX = ' · code';
const NOTES_SUFFIX = ' · notes';

/**
 * Swap the window's folders to show one ticket's code and notes.
 *
 * VS Code terminates and restarts the extension host when folder 0 changes,
 * or when a window goes from single-folder to multi-folder. So folder 0 is
 * never touched, and swapping only ever happens from index 1 upward - and
 * only in a window that is already a multi-root workspace.
 */
export function focusFolders(workspace: TaskWorkspace): 'swapped' | 'unsupported' | 'unchanged' {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length === 0) return 'unsupported';

  // Adding to a plain single-folder window would restart the extension host
  if (!vscode.workspace.workspaceFile) return 'unsupported';

  const wanted = [
    { path: workspace.worktreeDir, name: `${workspace.name}${CODE_SUFFIX}` },
    { path: workspace.notesDir, name: `${workspace.name}${NOTES_SUFFIX}` }
  ].filter(entry => directoryExists(entry.path));

  if (wanted.length === 0) return 'unchanged';

  // Never index 0 - see above
  const removable: number[] = [];
  for (let index = 1; index < folders.length; index++) {
    if (isTicketFolder(folders[index])) removable.push(index);
  }

  const alreadyShowing = wanted.every(entry =>
    folders.some(folder => samePath(folder.uri.fsPath, entry.path))
  );
  if (alreadyShowing && removable.length === wanted.length) return 'unchanged';

  const insertAt = removable.length > 0 ? removable[0] : folders.length;
  const deleteCount = removable.length;

  const added = wanted.map(entry => ({ uri: vscode.Uri.file(entry.path), name: entry.name }));

  vscode.workspace.updateWorkspaceFolders(insertAt, deleteCount, ...added);
  return 'swapped';
}

/**
 * Folders this extension manages, identified by the name it gave them
 */
function isTicketFolder(folder: vscode.WorkspaceFolder): boolean {
  return folder.name.endsWith(CODE_SUFFIX) || folder.name.endsWith(NOTES_SUFFIX);
}

function directoryExists(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}
