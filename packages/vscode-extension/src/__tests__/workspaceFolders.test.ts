import * as fs from 'fs';
import * as vscode from 'vscode';
import { focusFolders } from '../services/workspaceFolders';
import { TaskWorkspace } from '../services/workspaceService';

jest.mock('vscode');
jest.mock('fs');

const mockWorkspace = vscode.workspace as any;
const mockFs = fs as jest.Mocked<typeof fs>;

function workspaceFor(name: string): TaskWorkspace {
  return {
    ticket: name.split('-').slice(0, 2).join('-'),
    name,
    title: 'A task',
    status: 'in_progress',
    slug: null,
    taskFile: `/sabin/tasks/open/${name}.md`,
    notesDir: `/sabin/notes/${name}`,
    promptFile: `/sabin/prompts/${name}.md`,
    worktreeDir: `/dev/repo-worktrees/${name}`,
    branch: `angelo/${name}`
  };
}

function folder(fsPath: string, name: string) {
  return { uri: { fsPath }, name, index: 0 };
}

describe('focusFolders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFs.statSync.mockReturnValue({ isDirectory: () => true } as any);
    mockWorkspace.workspaceFile = { fsPath: '/sabin/repo.code-workspace' };
    mockWorkspace.workspaceFolders = [
      folder('/sabin', 'sabin'),
      folder('/dev/repo', 'repo')
    ];
  });

  it('appends ticket folders after the permanent ones', () => {
    const result = focusFolders(workspaceFor('DEMO-0001-telemetry'));

    expect(result).toBe('swapped');
    expect(mockWorkspace.updateWorkspaceFolders).toHaveBeenCalledWith(
      2,
      0,
      expect.objectContaining({ name: 'DEMO-0001-telemetry · code' }),
      expect.objectContaining({ name: 'DEMO-0001-telemetry · notes' })
    );
  });

  it('replaces the previous ticket folders rather than accumulating', () => {
    mockWorkspace.workspaceFolders = [
      folder('/sabin', 'sabin'),
      folder('/dev/repo', 'repo'),
      folder('/dev/repo-worktrees/DEMO-0001-telemetry', 'DEMO-0001-telemetry · code'),
      folder('/sabin/notes/DEMO-0001-telemetry', 'DEMO-0001-telemetry · notes')
    ];

    focusFolders(workspaceFor('DEMO-0002-input'));

    expect(mockWorkspace.updateWorkspaceFolders).toHaveBeenCalledWith(
      2,
      2,
      expect.objectContaining({ name: 'DEMO-0002-input · code' }),
      expect.objectContaining({ name: 'DEMO-0002-input · notes' })
    );
  });

  it('never touches folder 0, which would restart the extension host', () => {
    mockWorkspace.workspaceFolders = [
      folder('/dev/repo-worktrees/DEMO-0001-x', 'DEMO-0001-x · code'),
      folder('/sabin', 'sabin')
    ];

    focusFolders(workspaceFor('DEMO-0002-y'));

    const [insertAt] = mockWorkspace.updateWorkspaceFolders.mock.calls[0];
    expect(insertAt).toBeGreaterThanOrEqual(1);
  });

  it('refuses to swap in a plain folder window, which would also restart it', () => {
    mockWorkspace.workspaceFile = undefined;

    expect(focusFolders(workspaceFor('DEMO-0001-telemetry'))).toBe('unsupported');
    expect(mockWorkspace.updateWorkspaceFolders).not.toHaveBeenCalled();
  });

  it('does nothing when the ticket is already showing', () => {
    mockWorkspace.workspaceFolders = [
      folder('/sabin', 'sabin'),
      folder('/dev/repo', 'repo'),
      folder('/dev/repo-worktrees/DEMO-0001-telemetry', 'DEMO-0001-telemetry · code'),
      folder('/sabin/notes/DEMO-0001-telemetry', 'DEMO-0001-telemetry · notes')
    ];

    expect(focusFolders(workspaceFor('DEMO-0001-telemetry'))).toBe('unchanged');
    expect(mockWorkspace.updateWorkspaceFolders).not.toHaveBeenCalled();
  });

  it('skips directories that do not exist yet', () => {
    mockFs.statSync.mockImplementation(((target: string) =>
      target.includes('notes')
        ? ({ isDirectory: () => true } as any)
        : (() => { throw new Error('ENOENT'); })()) as any);

    focusFolders(workspaceFor('DEMO-0001-telemetry'));

    const added = mockWorkspace.updateWorkspaceFolders.mock.calls[0].slice(2);
    expect(added).toHaveLength(1);
    expect(added[0].name).toBe('DEMO-0001-telemetry · notes');
  });
});
