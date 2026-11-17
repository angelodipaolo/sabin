import { BrowserWindow, Menu, clipboard, dialog, ipcMain, shell } from 'electron';
import {
  addRepo,
  createProject,
  createTask,
  createWorkspace,
  ensureHome,
  findRepo,
  getTask,
  isTaskStatus,
  nextTaskId,
  readConfig,
  removeRepo,
  setTaskStatus,
  updateTask
} from '@sabin/core';
import type { Bounds, Result } from '../shared/types';
import { createTaskFile, deletableNote, listTaskFiles, readTaskFile, renameTaskFile, writeTaskFile } from './files';
import { ReviewView, runRede } from './rede';
import { taskFilePath } from './paths';
import { loadParts } from './snapshot';
import { focusSession, openTerminal, resumeSession } from './terminal';

export interface IpcContext {
  home: string;
  window(): BrowserWindow | null;
  /** Re-snapshot now, after a mutation the watcher may not see (worktrees live outside the home) */
  refresh(): void;
  getSnapshot(): Promise<import('../shared/types').Snapshot>;
  takeInitialTask(): string | null;
  review: ReviewView;
  setRedeAvailable(available: boolean): void;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

function str(value: unknown, what: string): string {
  if (typeof value !== 'string') throw new Error(`Expected ${what}.`);
  return value;
}

/** A yes/no sheet. Tests set SABIN_APP_AUTOCONFIRM=1, since nothing can click a native sheet. */
async function confirm(win: BrowserWindow | null, text: string, detail: string, action: string): Promise<boolean> {
  if (process.env.SABIN_APP_AUTOCONFIRM === '1') return true;
  const options = { type: 'warning' as const, buttons: [action, 'Cancel'], defaultId: 0, cancelId: 1, message: text, detail };
  const { response } = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
  return response === 0;
}

/** A workspace path from the renderer is only trusted once git lists it for that task */
async function knownWorkspace(home: string, taskId: string, workspacePath: string): Promise<string> {
  const { workspaces } = await loadParts(home);
  const found = workspaces.find(workspace => workspace.taskId === taskId && workspace.path === workspacePath);
  if (!found) throw new Error('That worktree is not one of this task\'s workspaces.');
  return found.path;
}

export function registerIpc(ctx: IpcContext): void {
  const { home } = ctx;
  const handle = (channel: string, fn: (...args: any[]) => Promise<unknown>) => {
    ipcMain.handle(channel, (_event, ...args) => fn(...args));
  };
  const mutate = <T>(fn: () => Promise<T>) => wrap(async () => {
    const value = await fn();
    ctx.refresh();
    return value;
  });

  handle('snapshot:get', () => ctx.getSnapshot());
  handle('app:initialTask', async () => ctx.takeInitialTask());
  handle('home:create', () => mutate(async () => {
    await ensureHome(home);
  }));

  handle('task:nextId', (project: unknown) => wrap(async () =>
    nextTaskId(home, await readConfig(home), project === undefined ? undefined : str(project, 'a project'))));

  handle('task:create', (input: { title?: unknown; id?: unknown; project?: unknown }) => mutate(async () => {
    const config = await readConfig(home);
    const task = await createTask(home, config, {
      title: str(input?.title, 'a title'),
      id: typeof input?.id === 'string' ? input.id : undefined,
      project: typeof input?.project === 'string' ? input.project : undefined
    });
    return task.id;
  }));
  handle('task:setStatus', (id: unknown, status: unknown) => mutate(async () => {
    if (!isTaskStatus(status)) throw new Error(`Unknown status: ${String(status)}`);
    await setTaskStatus(home, str(id, 'a task ID'), status);
  }));
  handle('task:update', (id: unknown, update: { title?: unknown; project?: unknown }) => mutate(async () => {
    await updateTask(home, str(id, 'a task ID'), {
      title: typeof update?.title === 'string' ? update.title : undefined,
      project: update?.project === null ? null : typeof update?.project === 'string' ? update.project : undefined
    });
  }));
  handle('project:create', (title: unknown) => mutate(async () => (await createProject(home, { title: str(title, 'a title') })).slug));

  handle('repo:add', () => mutate(async () => {
    const win = ctx.window();
    const options: Electron.OpenDialogOptions = {
      title: 'Add a repository',
      buttonLabel: 'Add Repository',
      properties: ['openDirectory']
    };
    const picked = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return null;
    return (await addRepo(home, picked.filePaths[0])).repo.name;
  }));
  handle('repo:remove', (name: unknown) => mutate(async () => {
    const repoName = str(name, 'a repo name');
    const ok = await confirm(ctx.window(), `Remove “${repoName}” from Sabin?`, 'Only the registration is removed. The repository, its worktrees and branches stay on disk.', 'Remove');
    if (!ok) return false;
    await removeRepo(home, repoName);
    return true;
  }));
  handle('workspace:create', (taskId: unknown, repoName: unknown) => mutate(async () => {
    const config = await readConfig(home);
    const repo = findRepo(config, str(repoName, 'a repo name'));
    if (!repo) throw new Error(`No registered repo named "${String(repoName)}".`);
    const task = await getTask(home, str(taskId, 'a task ID'));
    const result = await createWorkspace(config, task, repo);
    const failed = result.postCreate.find(step => !step.ok);
    if (failed) {
      throw new Error(`Created ${result.workspace.path}, but postCreate \`${failed.command}\` failed: ${failed.output.trim().split('\n').slice(-3).join(' ')}`);
    }
    return result.workspace.path;
  }));

  handle('file:list', (taskId: unknown) => wrap(() => listTaskFiles(home, str(taskId, 'a task ID'))));
  handle('file:read', (taskId: unknown, name: unknown) => wrap(() => readTaskFile(home, str(taskId, 'a task ID'), str(name, 'a file name'))));
  // Writes refresh through the watcher; no explicit refresh, or every keystroke pause would re-run git
  handle('file:write', (taskId: unknown, name: unknown, content: unknown) =>
    wrap(() => writeTaskFile(home, str(taskId, 'a task ID'), str(name, 'a file name'), str(content, 'text'))));
  handle('file:create', (taskId: unknown, name: unknown) => mutate(() => createTaskFile(home, str(taskId, 'a task ID'), str(name, 'a file name'))));
  handle('file:rename', (taskId: unknown, from: unknown, to: unknown) =>
    mutate(() => renameTaskFile(home, str(taskId, 'a task ID'), str(from, 'a file name'), str(to, 'a file name'))));
  handle('file:delete', (taskId: unknown, name: unknown) => mutate(async () => {
    const file = await deletableNote(home, str(taskId, 'a task ID'), str(name, 'a file name'));
    const ok = await confirm(ctx.window(), `Move “${String(name)}” to the Trash?`, 'You can restore it from the Trash in Finder.', 'Move to Trash');
    if (!ok) return false;
    await shell.trashItem(file);
    return true;
  }));
  handle('file:menu', (taskId: unknown, name: unknown) => new Promise(resolvePromise => {
    const fileName = str(name, 'a file name');
    str(taskId, 'a task ID');
    let chosen: string | null = null;
    const pick = (value: string) => () => {
      chosen = value;
      resolvePromise(value);
    };
    const reserved = ['task.md', 'prompt.md', 'plan.md', 'log.md'].includes(fileName);
    const deletable = !['task.md', 'prompt.md'].includes(fileName);
    const menu = Menu.buildFromTemplate([
      { label: 'Rename…', enabled: !reserved, click: pick('rename') },
      { label: 'Reveal in Finder', click: pick('reveal') },
      { type: 'separator' },
      { label: 'Move to Trash', enabled: deletable, click: pick('delete') }
    ]);
    menu.popup({
      window: ctx.window() ?? undefined,
      // Click handlers can run after the close callback; give them a tick
      callback: () => setTimeout(() => {
        if (chosen === null) resolvePromise(null);
      }, 50)
    });
  }));
  handle('file:reveal', (taskId: unknown, name: unknown) => wrap(async () => {
    shell.showItemInFolder(taskFilePath(home, str(taskId, 'a task ID'), str(name, 'a file name')));
  }));

  handle('terminal:focus', (sessionId: unknown) => wrap(() => focusSession(home, str(sessionId, 'a session ID'))));
  handle('terminal:resume', (sessionId: unknown) => wrap(() => resumeSession(home, str(sessionId, 'a session ID'))));
  handle('terminal:open', (taskId: unknown, workspacePath: unknown) =>
    wrap(() => openTerminal(home, str(taskId, 'a task ID'), str(workspacePath, 'a path'))));

  handle('shell:copy', async (text: unknown) => {
    if (typeof text === 'string') clipboard.writeText(text);
  });
  handle('shell:reveal', (taskId: unknown, workspacePath: unknown) => wrap(async () => {
    shell.showItemInFolder(await knownWorkspace(home, str(taskId, 'a task ID'), str(workspacePath, 'a path')));
  }));
  handle('shell:openExternal', async (url: unknown) => {
    if (typeof url === 'string' && /^https?:\/\//.test(url)) await shell.openExternal(url);
  });

  handle('review:open', (taskId: unknown, workspacePath: unknown) => wrap(async () => {
    const dir = await knownWorkspace(home, str(taskId, 'a task ID'), str(workspacePath, 'a path'));
    try {
      const result = await runRede(dir);
      ctx.setRedeAvailable(true);
      ctx.review.allow(result.url);
      return result;
    } catch (error) {
      if (/not installed/.test(message(error))) ctx.setRedeAvailable(false);
      throw error;
    }
  }));
  handle('review:show', (url: unknown, bounds: Bounds) => wrap(async () => {
    if (!bounds || [bounds.x, bounds.y, bounds.width, bounds.height].some(value => typeof value !== 'number')) {
      throw new Error('Bad bounds.');
    }
    ctx.review.show(str(url, 'a URL'), bounds);
  }));
  handle('review:hide', async () => ctx.review.hide());
}
