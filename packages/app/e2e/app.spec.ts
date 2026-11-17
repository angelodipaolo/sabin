import fs from 'fs/promises';
import path from 'path';
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
  app = await electron.launch({ args: [appDir], env: appEnv(fixture) });
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
  await page.locator('[data-file="research.md"]').click();
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
  await expect.poll(async () => parseFrontmatter(await taskFile('SABIN-0001')).data.status).toBe('review');
  // Entering review is one of the two things that notify
  await expect.poll(async () => (await hooks()).notifications.map(notice => notice.taskId)).toContain('SABIN-0001');
  await page.locator('select[name="status"]').selectOption('in_progress');
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
  await page.locator('input[name="title"]').fill('Dock badge for waiting agents');
  await page.locator('.sheet select[name="project"]').selectOption('command-center');
  await page.getByRole('button', { name: 'Create Task' }).click();
  await expect(page.locator('.task-id')).toHaveText('SABIN-0011');
  const { data } = parseFrontmatter(await taskFile('SABIN-0011'));
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
