import fs from 'fs/promises';
import path from 'path';
import { execFileSync } from 'child_process';
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { parseFrontmatter } from '@sabin/core';
import { appEnv, buildFixture, Fixture } from './fixture';

/**
 * End-to-end smoke test: the built app against a fixture home, with the
 * terminal and notifications stubbed. Nothing here sends an Apple Event.
 */

const appDir = path.resolve(__dirname, '..');

let fixture: Fixture;
let app: ElectronApplication;
let page: Page;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  fixture = await buildFixture();
  const executablePath = execFileSync(process.execPath, ['-p', "require('./bin/electron-path').electronPath()"], { cwd: appDir, encoding: 'utf8' }).trim();
  app = await electron.launch({ executablePath, args: [appDir], env: appEnv(fixture) });
  page = await app.firstWindow();
  await page.waitForSelector('[data-group]');
});

test.afterAll(async () => {
  await app?.close();
  await fixture?.cleanup();
});

/** Click a menu item, which is how a real ⌘K / ⌘N reaches the page */
async function menu(id: string): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => {
    Menu.getApplicationMenu()!.getMenuItemById(itemId)!.click();
  }, id);
}

async function hooks(): Promise<{ terminal: Record<string, unknown>[]; notifications: { title: string; taskId: string | null }[] }> {
  return app.evaluate(() => {
    const store = (globalThis as any).__sabinTest;
    return { terminal: store?.terminal ?? [], notifications: store?.notifications ?? [] };
  });
}

async function taskFile(id: string, name = 'task.md'): Promise<string> {
  return fs.readFile(path.join(fixture.home, 'tasks', id, name), 'utf8');
}

test('renders the attention list in group order', async () => {
  expect(await app.evaluate(({ app }) => app.getName())).toBe('Sabin');
  if (process.platform === 'darwin') {
    const executable = await app.evaluate(({ app }) => app.getPath('exe'));
    expect(executable).toContain('/Sabin.app/');
    const plist = path.resolve(executable, '../../Info.plist');
    expect(execFileSync('/usr/bin/plutil', ['-extract', 'CFBundleDisplayName', 'raw', plist], { encoding: 'utf8' }).trim()).toBe('Sabin');
  }
  const groups = await page.locator('[data-group]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-group')));
  expect(groups).toEqual(['needs-you', 'working', 'in_progress', 'ready', 'open', 'completed', 'others']);

  // Waiting agents first, longest wait first; then tasks in review
  const needsYou = await page.locator('[data-group="needs-you"] [data-task-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-task-id')));
  expect(needsYou).toEqual(['SABIN-0001', 'SABIN-0006', 'SABIN-0002', 'ARCH-1234']);

  await expect(page.locator('[data-group="working"] [data-task-id]')).toHaveCount(1);
  await expect(page.locator('[data-group="working"] [data-task-id="SABIN-0003"]')).toBeVisible();

  // Completed is folded by default
  await expect(page.locator('[data-group="completed"] [data-task-id]')).toHaveCount(0);
  await page.locator('[data-group="completed"] .group-head').click();
  await expect(page.locator('[data-group="completed"] [data-task-id]')).toHaveCount(2);
  await page.locator('[data-group="completed"] .group-head').click();

  const first = page.locator('[data-task-id="SABIN-0001"]');
  await expect(first).toContainText('Waiting');
  await expect(first).toContainText('Approve the command?');
  await expect(first.locator('.chip')).toHaveCount(2);
  await expect(first.locator('.chip', { hasText: 'web' })).toContainText('↑2');
  await expect(page.locator('[data-task-id="SABIN-0003"] .chip')).toContainText('•2');
});

test('filters by project from the sidebar', async () => {
  await page.locator('[data-filter="billing"]').click();
  const ids = await page.locator('[data-task-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-task-id')));
  expect(ids.sort()).toEqual(['SABIN-0003', 'SABIN-0004', 'SABIN-0005']);
  await page.locator('[data-filter="all"]').click();
});

test('opens a task from the keyboard', async () => {
  await page.locator('.list-scroll').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.task-id')).toHaveText('SABIN-0001');
  await expect(page.locator('input[name="task-title"]')).toHaveValue('Command center desktop app');
  await expect(page.locator('[data-testid="workspaces-panel"] .workspace')).toHaveCount(2);
  await expect(page.locator('[data-testid="sessions-panel"] .session')).toHaveCount(1);
  await menu('back');
  await expect(page.locator('[data-group="needs-you"]')).toBeVisible();
});

test('edits and saves a note', async () => {
  await page.locator('[data-task-id="SABIN-0001"]').click();
  await page.getByRole('button', { name: 'Notes', exact: true }).click();
  await page.getByRole('menuitem', { name: 'research.md', exact: true }).click();
  const editor = page.locator('[data-testid="editor"] .cm-content');
  await expect(editor).toContainText('WebContentsView');
  await editor.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type('\nSaved from the end-to-end test.');
  await expect(page.locator('[data-testid="save-state"]')).toHaveText('Saved', { timeout: 5000 });
  await expect.poll(() => taskFile('SABIN-0001', 'research.md')).toContain('Saved from the end-to-end test.');
});

test('task.md edits keep the frontmatter', async () => {
  await page.locator('[data-file="task.md"]').click();
  const editor = page.locator('[data-testid="editor"] .cm-content');
  await expect(editor).toContainText('One place to see every task');
  await expect(editor).not.toContainText('status:');
  await editor.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type('\nBody edit.');
  await expect.poll(() => taskFile('SABIN-0001')).toContain('Body edit.');
  const { data } = parseFrontmatter(await taskFile('SABIN-0001'));
  expect(data).toMatchObject({ status: 'in_progress', title: 'Command center desktop app', project: 'command-center' });
});

test('reloads a clean buffer when the file changes on disk', async () => {
  await page.locator('[data-file="plan.md"]').click();
  const editor = page.locator('[data-testid="editor"] .cm-content');
  await expect(editor).toContainText('Snapshot in the main process');
  await fs.writeFile(path.join(fixture.home, 'tasks', 'SABIN-0001', 'plan.md'), '# Plan\n\nRewritten by an agent.\n');
  await expect(editor).toContainText('Rewritten by an agent.');
});

test('keeps a dirty buffer and offers reload when the file changes underneath', async () => {
  const editor = page.locator('[data-testid="editor"] .cm-content');
  await editor.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type('\nMine');
  // Write before the autosave fires
  await fs.writeFile(path.join(fixture.home, 'tasks', 'SABIN-0001', 'plan.md'), '# Plan\n\nTheirs.\n');
  const bar = page.locator('.file-bar');
  const sawBar = await bar.waitFor({ timeout: 3000 }).then(() => true).catch(() => false);
  if (sawBar) {
    await bar.getByText('Reload').click();
    await expect(editor).toContainText('Theirs.');
    await expect(editor).not.toContainText('Mine');
  } else {
    // The autosave won the race; the buffer was saved over the outside write, which is the "keep" path
    await expect.poll(() => taskFile('SABIN-0001', 'plan.md')).toContain('Mine');
  }
});

test('changes status and writes the frontmatter', async () => {
  await page.locator('select[name="status"]').selectOption('review');
  await expect(page.locator('select[name="status"]')).toHaveValue('review');
  await expect.poll(async () => parseFrontmatter(await taskFile('SABIN-0001')).data.status).toBe('review');
  // Entering review is one of the two things that notify
  await expect.poll(async () => (await hooks()).notifications.map(notice => notice.taskId)).toContain('SABIN-0001');
  await page.locator('select[name="status"]').selectOption('in_progress');
  await expect(page.locator('select[name="status"]')).toHaveValue('in_progress');
  await expect.poll(async () => parseFrontmatter(await taskFile('SABIN-0001')).data.status).toBe('in_progress');
});

test('terminal actions go to the fake driver', async () => {
  await page.locator('[data-workspace="web"]').getByRole('button', { name: 'Terminal' }).click();
  await page.locator('[data-testid="sessions-panel"]').getByRole('button', { name: 'Focus' }).click();
  await expect.poll(async () => (await hooks()).terminal.length).toBe(2);
  const calls = (await hooks()).terminal;
  expect(calls[0]).toMatchObject({ action: 'openTab', cwd: fixture.worktree('SABIN-0001', 'web'), taskId: 'SABIN-0001' });
  expect(calls[1]).toMatchObject({ action: 'focus', sessionId: 'FAKE-TERM-0001' });

  // Resume an ended session
  await menu('switcher');
  await page.keyboard.type('webhook');
  await page.keyboard.press('Enter');
  await expect(page.locator('.task-id')).toHaveText('SABIN-0004');
  await page.locator('[data-testid="sessions-panel"]').getByRole('button', { name: 'Resume' }).click();
  await expect.poll(async () => (await hooks()).terminal.length).toBe(3);
  expect((await hooks()).terminal[2]).toMatchObject({
    action: 'openTab',
    command: 'codex resume 019a7c1e-0004-ended-codex',
    cwd: fixture.worktree('SABIN-0004', 'api')
  });
});

test('quick switcher finds tasks by fuzzy title and status', async () => {
  await menu('switcher');
  const input = page.locator('.switcher-input');
  await expect(input).toBeFocused();
  await input.fill('rate lim');
  await expect(page.locator('.switcher-row').first()).toHaveAttribute('data-task-id', 'ARCH-1234');
  await input.fill('docs compl');
  await expect(page.locator('.switcher-row').first()).toHaveAttribute('data-task-id', 'SABIN-0007');
  await page.keyboard.press('Enter');
  await expect(page.locator('.task-id')).toHaveText('SABIN-0007');
  await menu('list');
  await expect(page.locator('[data-group="needs-you"]')).toBeVisible();
});

test('creates a task', async () => {
  await menu('new-task');
  await expect(page.locator('input[name="id"]')).toHaveValue('SABIN-0011');
  await page.locator('input[name="title"]').fill('Dock badge for waiting agents');
  await page.locator('.sheet select[name="project"]').selectOption('command-center');
  await expect(page.locator('input[name="id"]')).toHaveValue('COMMANDCENTER-0001');
  await page.getByRole('button', { name: 'Create Task' }).click();
  await expect(page.locator('.task-id')).toHaveText('COMMANDCENTER-0001');
  const { data } = parseFrontmatter(await taskFile('COMMANDCENTER-0001'));
  expect(data).toMatchObject({ title: 'Dock badge for waiting agents', status: 'open', project: 'command-center' });
  await expect(page.locator('[data-file="prompt.md"]')).toBeVisible();
});

test('creates and renames nothing outside the task directory', async () => {
  const outside = await app.evaluate(async ({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    return wc.executeJavaScript(`Promise.all([
      window.sabin.readFile('SABIN-0001', '../../config.json'),
      window.sabin.writeFile('../SABIN-0001', 'task.md', 'x'),
      window.sabin.createFile('SABIN-0001', '../escape.md'),
      window.sabin.renameFile('SABIN-0001', 'research.md', 'task.md')
    ])`);
  });
  for (const result of outside) expect(result.ok).toBe(false);
  await expect(fs.access(path.join(fixture.home, 'tasks', 'escape.md'))).rejects.toThrow();
});

test('a second launch with --task focuses this window and opens the task', async () => {
  const { spawn } = await import('child_process');
  const launcher = path.join(appDir, 'bin', 'sabin-app.js');
  const env = appEnv(fixture);
  // Through the real launcher: detached, forwarding arguments
  const child = spawn(process.execPath, [launcher, '--task', 'sabin-0003'], { env, stdio: 'ignore' });
  await new Promise(resolve => child.on('exit', resolve));
  await expect(page.locator('.task-id')).toHaveText('SABIN-0003', { timeout: 15_000 });
  expect(app.windows()).toHaveLength(1);
});


test('changes status directly from the list without opening the task', async () => {
  await menu('list');
  const row = page.locator('[data-task-id="SABIN-0005"]');
  await row.getByRole('combobox', { name: 'Status for SABIN-0005' }).selectOption('ready');
  await expect.poll(async () => parseFrontmatter(await taskFile('SABIN-0005')).data.status).toBe('ready');
  await expect(page.locator('.task-view')).toHaveCount(0);
  await expect(page.locator('[data-group="ready"] [data-task-id="SABIN-0005"]')).toBeVisible();
  await row.getByRole('combobox', { name: 'Status for SABIN-0005' }).selectOption('in_progress');
  await expect(row.getByRole('combobox')).toHaveValue('in_progress');
  await row.getByRole('combobox').selectOption('completed');
  await expect(row).toHaveCount(0);
  await expect.poll(async () => parseFrontmatter(await taskFile('SABIN-0005')).data.status).toBe('completed');
  const completed = page.locator('[data-group="completed"]');
  await completed.locator('.group-head').click();
  await expect(completed.locator('[data-task-id="SABIN-0005"] select')).toHaveValue('completed');
  await completed.locator('.group-head').click();
});

test('browses notes, keeps multiple tabs, closes and reopens notes, and cycles tabs', async () => {
  await page.locator('[data-task-id="SABIN-0001"]').click();
  const browse = page.getByRole('button', { name: 'Notes', exact: true });
  await browse.click();
  await expect(page.getByRole('menuitem').first()).toHaveText('Note');
  for (const name of ['task.md', 'prompt.md', 'plan.md', 'log.md']) {
    await expect(page.getByRole('menuitem', { name, exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: `Close ${name}`, exact: true })).toHaveCount(0);
  }
  await page.getByRole('menuitem', { name: 'research.md', exact: true }).click();
  await browse.click();
  await page.getByRole('menuitem', { name: 'Note', exact: true }).click();
  await page.locator('.sheet input').fill('second.md');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('[data-file="research.md"]')).toBeVisible();
  await expect(page.locator('[data-file="second.md"]')).toHaveAttribute('aria-selected', 'true');
  if (process.env.SABIN_APP_SHOTS) {
    await fs.mkdir(process.env.SABIN_APP_SHOTS, { recursive: true });
    await browse.click();
    await page.screenshot({ path: path.join(process.env.SABIN_APP_SHOTS, '13-notes-menu-and-tabs.png') });
    await browse.click();
  }
  const editor = page.locator('[data-testid="editor"] .cm-content');
  await editor.click();
  await page.keyboard.type('Save when switching tabs');
  await menu('previous-tab');
  await expect(page.locator('[data-file="research.md"]')).toHaveAttribute('aria-selected', 'true');
  await expect.poll(() => taskFile('SABIN-0001', 'second.md')).toContain('Save when switching tabs');
  await menu('next-tab');
  await expect(page.locator('[data-file="second.md"]')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+Tab');
  await expect(page.locator('[data-file="task.md"]')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Control+Shift+Tab');
  await expect(page.locator('[data-file="second.md"]')).toHaveAttribute('aria-selected', 'true');
  await editor.click();
  await page.keyboard.press('Meta+ArrowDown');
  await page.keyboard.type(' and closing');
  await page.getByRole('button', { name: 'Close second.md', exact: true }).click();
  await expect(page.locator('[data-file="second.md"]')).toHaveCount(0);
  await expect.poll(() => taskFile('SABIN-0001', 'second.md')).toContain('Save when switching tabs and closing');
  await browse.click();
  await page.getByRole('menuitem', { name: 'second.md', exact: true }).click();
  await expect(editor).toContainText('Save when switching tabs and closing');
});

test('keeps a custom ID when the selected project changes', async () => {
  await menu('new-task');
  await expect(page.locator('input[name="title"]')).toBeFocused();
  await page.locator('input[name="id"]').fill('CUSTOM-42');
  await expect(page.locator('input[name="id"]')).toHaveValue('CUSTOM-42');
  await page.locator('.sheet select[name="project"]').selectOption('billing');
  await expect(page.locator('input[name="id"]')).toHaveValue('CUSTOM-42');
  await page.locator('input[name="title"]').fill('Custom ticket');
  await page.getByRole('button', { name: 'Create Task' }).click();
  await expect(page.locator('.task-id')).toHaveText('CUSTOM-42');
  expect(parseFrontmatter(await taskFile('CUSTOM-42')).data.project).toBe('billing');
});

test('registers text size shortcuts and changes zoom while editing', async () => {
  const accelerators = await app.evaluate(({ Menu }) => ['zoom-in', 'zoom-in-equals', 'zoom-out', 'zoom-reset'].map(
    id => Menu.getApplicationMenu()!.getMenuItemById(id)!.accelerator
  ));
  expect(accelerators).toEqual(['CmdOrCtrl+Plus', 'CmdOrCtrl+=', 'CmdOrCtrl+-', 'CmdOrCtrl+0']);
  await menu('switcher');
  await page.locator('.switcher input').fill('Command center desktop app');
  await page.keyboard.press('Enter');
  const editor = page.locator('[data-testid="editor"] .cm-content');
  await expect(editor).toBeVisible();
  await editor.click();
  const content = await editor.innerText();
  const zoom = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomLevel());
  const changeZoom = (id: string) => app.evaluate(({ Menu, BrowserWindow }, itemId) => {
    const win = BrowserWindow.getAllWindows()[0];
    Menu.getApplicationMenu()!.getMenuItemById(itemId)!.click({}, win, win.webContents);
  }, id);
  // DevTools key events bypass native macOS menu accelerators. Invoke the
  // registered menu actions to exercise their zoom behavior in Electron.
  await changeZoom('zoom-in-equals');
  await expect.poll(zoom).toBeGreaterThan(0);
  const increased = await zoom();
  await changeZoom('zoom-in');
  await expect.poll(zoom).toBeGreaterThan(increased);
  await changeZoom('zoom-out');
  await expect.poll(zoom).toBeCloseTo(increased);
  await changeZoom('zoom-reset');
  await expect.poll(zoom).toBe(0);
  await changeZoom('zoom-out');
  await expect.poll(zoom).toBeLessThan(0);
  await changeZoom('zoom-reset');
  await expect.poll(zoom).toBe(0);
  await expect(editor).toHaveText(content, { useInnerText: true });
});
