import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import type { AppCommand, SabinApi, Snapshot } from '../shared/types';

/**
 * The renderer's only door to the system. Every method is a named IPC call
 * with arguments the main process validates; nothing here touches the disk,
 * and no Node or Electron object crosses the bridge.
 */

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api: SabinApi = {
  getSnapshot: () => invoke('snapshot:get'),
  initialTask: () => invoke('app:initialTask'),
  createHome: () => invoke('home:create'),

  nextTaskId: project => invoke('task:nextId', project),
  createTask: input => invoke('task:create', input),
  setStatus: (id, status) => invoke('task:setStatus', id, status),
  updateTask: (id, update) => invoke('task:update', id, update),
  createProject: title => invoke('project:create', title),
  addRepo: () => invoke('repo:add'),
  removeRepo: name => invoke('repo:remove', name),
  repoProjectMenu: name => invoke('repo:projectMenu', name),
  setRepoProject: (name, project) => invoke('repo:setProject', name, project),
  createWorkspace: (taskId, repo) => invoke('workspace:create', taskId, repo),

  listFiles: taskId => invoke('file:list', taskId),
  readFile: (taskId, name) => invoke('file:read', taskId, name),
  writeFile: (taskId, name, content) => invoke('file:write', taskId, name, content),
  createFile: (taskId, name) => invoke('file:create', taskId, name),
  renameFile: (taskId, from, to) => invoke('file:rename', taskId, from, to),
  deleteFile: (taskId, name) => invoke('file:delete', taskId, name),
  fileMenu: (taskId, name) => invoke('file:menu', taskId, name),
  revealFile: (taskId, name) => invoke('file:reveal', taskId, name),

  focusSession: sessionId => invoke('terminal:focus', sessionId),
  resumeSession: sessionId => invoke('terminal:resume', sessionId),
  openTerminal: (taskId, workspacePath) => invoke('terminal:open', taskId, workspacePath),
  copyText: text => invoke('shell:copy', text),
  reveal: (taskId, workspacePath) => invoke('shell:reveal', taskId, workspacePath),

  openReview: (taskId, workspacePath) => invoke('review:open', taskId, workspacePath),
  showReview: (url, bounds) => invoke('review:show', url, bounds),
  hideReview: () => invoke('review:hide'),
  openExternal: url => invoke('shell:openExternal', url),

  onSnapshot: listener => subscribe<Snapshot>('snapshot', listener),
  onCommand: listener => subscribe<AppCommand>('command', listener),
  onOpenTask: listener => subscribe<string>('open-task', listener)
};

contextBridge.exposeInMainWorld('sabin', api);
