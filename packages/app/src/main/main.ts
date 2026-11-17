import path from 'path';
import { app, BrowserWindow, Menu, MenuItemConstructorOptions, nativeTheme, session, shell } from 'electron';
import { resolveHome } from '@sabin/core';
import type { AppCommand, Snapshot } from '../shared/types';
import { taskFromArgv } from './args';
import { testHooks } from './testHooks';
import { registerIpc } from './ipc';
import { findMargin, ReviewView } from './margin';
import { Notifier } from './notify';
import { adoptLoginShellPath } from './shellEnv';
import { emptySnapshot, takeSnapshot } from './snapshot';
import { watchHome } from './watcher';
import { DEFAULT_SIZE, loadWindowState, trackWindowState } from './windowState';

/**
 * Process layout: this main process owns every file, git and terminal call,
 * all through @sabin/core. The renderer is a sandboxed Preact page that sees
 * only the preload bridge. Margin's review page, when open, is a separate
 * WebContentsView with its own session.
 */

const env = process.env;

// Tests and parallel dev runs use their own profile, so the single-instance
// lock and the window state never collide with a real running Sabin
if (env.SABIN_APP_USER_DATA) app.setPath('userData', env.SABIN_APP_USER_DATA);
app.setName('Sabin');

const home = resolveHome();
let mainWindow: BrowserWindow | null = null;
let pendingTask: string | null = taskFromArgv(process.argv);
let marginAvailable = false;
let version = 0;
let current: Snapshot | null = null;
let stopWatching: (() => void) | null = null;

const review = new ReviewView(() => mainWindow);
// Screenshots of the review need the native view's pixels, which a page screenshot cannot see
if (env.SABIN_APP_NO_TERMINAL === '1') testHooks().captureReview = () => review.capture();
const notifier = new Notifier(taskId => {
  const win = ensureWindow();
  win.show();
  win.focus();
  if (taskId) win.webContents.send('open-task', taskId);
});

// The task travels as additionalData too: Chromium reorders a second
// instance's argv, splitting `--task X` around its own switches
if (!app.requestSingleInstanceLock({ task: pendingTask })) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv, _cwd, additionalData) => {
    const win = ensureWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    const data = additionalData as { task?: unknown } | null;
    const taskId = (typeof data?.task === 'string' ? taskFromArgv(['--task', data.task]) : null) ?? taskFromArgv(argv);
    if (taskId) win.webContents.send('open-task', taskId);
  });
  app.whenReady().then(start).catch(error => {
    console.error(error);
    app.quit();
  });
}

// ---- Snapshots ------------------------------------------------------------

let running = false;
let again = false;

async function refresh(): Promise<void> {
  if (running) {
    again = true;
    return;
  }
  running = true;
  try {
    do {
      again = false;
      const next = await takeSnapshot(home, ++version, marginAvailable).catch(error => ({
        ...emptySnapshot(home, version, marginAvailable),
        homeExists: true,
        warnings: [`Could not read ${home}: ${error instanceof Error ? error.message : String(error)}`]
      }));
      current = next;
      if (next.homeExists && !stopWatching) stopWatching = watchHome(home, () => void refresh());
      notifier.update(next);
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('snapshot', next);
    } while (again);
  } finally {
    running = false;
  }
}

async function getSnapshot(): Promise<Snapshot> {
  if (!current) await refresh();
  return current!;
}

// ---- Window ---------------------------------------------------------------

function sendCommand(command: AppCommand): void {
  const win = ensureWindow();
  win.webContents.send('command', command);
}

function fixedSize(): { width: number; height: number } | null {
  const match = /^(\d+)x(\d+)$/.exec(env.SABIN_APP_WINDOW_SIZE ?? '');
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

function ensureWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  const fixed = fixedSize();
  const saved = fixed ? {} : loadWindowState();
  const vibrancy = env.SABIN_APP_NO_VIBRANCY !== '1';
  const win = new BrowserWindow({
    ...(fixed ?? saved.bounds ?? DEFAULT_SIZE),
    minWidth: 900,
    minHeight: 560,
    show: false,
    title: 'Sabin',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    vibrancy: vibrancy ? 'sidebar' : undefined,
    visualEffectState: 'followWindow',
    backgroundColor: vibrancy ? '#00000000' : undefined,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });
  if (saved.maximized) win.maximize();
  if (!fixed) trackWindowState(win);
  mainWindow = win;

  win.on('focus', () => void refresh());
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  win.once('ready-to-show', () => {
    if (env.SABIN_APP_HIDDEN !== '1') win.show();
  });

  // The renderer is a fixed local page: it never navigates, and links leave for the browser
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });

  const query = { vibrancy: vibrancy ? '1' : '0' };
  if (env.SABIN_APP_DEV_URL) void win.loadURL(`${env.SABIN_APP_DEV_URL}?vibrancy=${query.vibrancy}`);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'), { query });
  return win;
}

function buildMenu(): void {
  const send = (command: AppCommand) => () => sendCommand(command);
  const template: MenuItemConstructorOptions[] = [
    { role: 'appMenu' },
    {
      label: 'File',
      submenu: [
        { id: 'new-task', label: 'New Task…', accelerator: 'CmdOrCtrl+N', click: send('new-task') },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { id: 'list', label: 'Task List', accelerator: 'CmdOrCtrl+1', click: send('list') },
        { id: 'switcher', label: 'Go to Task…', accelerator: 'CmdOrCtrl+K', click: send('switcher') },
        { id: 'back', label: 'Back', accelerator: 'CmdOrCtrl+[', click: send('back') },
        { type: 'separator' },
        { label: 'Reload Data', accelerator: 'CmdOrCtrl+R', click: () => void refresh() },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as MenuItemConstructorOptions]),
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- Start ----------------------------------------------------------------

async function start(): Promise<void> {
  if (env.SABIN_APP_THEME === 'dark' || env.SABIN_APP_THEME === 'light') nativeTheme.themeSource = env.SABIN_APP_THEME;

  // Nothing the renderer or Margin's page asks for (camera, notifications from the page, ...) is granted
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', event => event.preventDefault());
  });

  if (env.SABIN_APP_SHELL_PATH !== '0') await adoptLoginShellPath();
  marginAvailable = Boolean(await findMargin());

  registerIpc({
    home,
    window: () => mainWindow,
    refresh: () => void refresh(),
    getSnapshot,
    takeInitialTask: () => {
      const taskId = pendingTask;
      pendingTask = null;
      return taskId;
    },
    review,
    setMarginAvailable: available => {
      marginAvailable = available;
    }
  });

  buildMenu();
  ensureWindow();
  await refresh();

  app.on('activate', () => {
    ensureWindow().show();
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopWatching?.();
});
