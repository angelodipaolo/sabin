import fs from 'fs/promises';
import path from 'path';
import { test, expect, _electron as electron, ElectronApplication, Page } from '@playwright/test';
import { appEnv, buildFixture, Fixture } from './fixture';

/**
 * Screenshots for design review, from the same fixture as the smoke test.
 * Runs only when SABIN_APP_SHOTS names an output directory:
 *
 *   SABIN_APP_SHOTS=/tmp/shots npm run test:e2e -w @sabin/app
 */

const out = process.env.SABIN_APP_SHOTS;
const appDir = path.resolve(__dirname, '..');

test.describe.configure({ mode: 'serial' });
test.skip(!out, 'Set SABIN_APP_SHOTS to an output directory to take screenshots');

let fixture: Fixture;
let app: ElectronApplication;
let page: Page;

async function launch(size: string, theme: 'light' | 'dark'): Promise<void> {
  app = await electron.launch({ args: [appDir], env: appEnv(fixture, { SABIN_APP_WINDOW_SIZE: size, SABIN_APP_THEME: theme }), colorScheme: theme });
  page = await app.firstWindow();
  await page.waitForSelector('[data-group]');
  // Let the busy dot settle on a visible frame and fonts load
  await page.waitForTimeout(400);
}

async function shot(name: string): Promise<void> {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(out!, `${name}.png`) });
}

async function menu(id: string): Promise<void> {
  await app.evaluate(({ Menu }, itemId) => {
    Menu.getApplicationMenu()!.getMenuItemById(itemId)!.click();
  }, id);
}

test.beforeAll(async () => {
  await fs.mkdir(out!, { recursive: true });
  fixture = await buildFixture();
});

test.afterAll(async () => {
  await app?.close().catch(() => undefined);
  await fixture?.cleanup();
});

test('light, 1100x720', async () => {
  await launch('1100x720', 'light');
  await shot('01-list-light-1100x720');

  await page.locator('[data-task-id="SABIN-0001"]').click();
  await page.locator('[data-file="plan.md"]').click();
  await expect(page.locator('[data-testid="editor"] .cm-content')).toContainText('Snapshot');
  await page.locator('.segmented button', { hasText: 'Split' }).click();
  await shot('03-task-editor-split-light-1100x720');
  await page.locator('.segmented button', { hasText: 'Edit' }).click();

  await page.locator('[data-task-id], .back').first().click();
  await page.locator('[data-task-id="SABIN-0002"]').click();
  await expect(page.locator('[data-testid="sessions-panel"] .session')).toHaveCount(1);
  await shot('04-task-sessions-workspaces-light-1100x720');

  await menu('switcher');
  await page.locator('.switcher-input').waitFor();
  await page.keyboard.type('bill');
  await shot('05-quick-switcher-light-1100x720');
  await page.keyboard.press('Escape');

  await menu('new-task');
  await page.locator('input[name="title"]').fill('Dock badge for waiting agents');
  await shot('06-new-task-light-1100x720');
  await page.keyboard.press('Escape');
  await app.close();
});

test('dark, 1100x720', async () => {
  await launch('1100x720', 'dark');
  await shot('02-list-dark-1100x720');
  await page.locator('[data-task-id="SABIN-0001"]').click();
  await expect(page.locator('[data-testid="sessions-panel"] .session')).toHaveCount(1);
  await shot('07-task-dark-1100x720');
  await menu('switcher');
  await page.locator('.switcher-input').waitFor();
  await page.keyboard.type('docs');
  await shot('08-quick-switcher-dark-1100x720');
  await app.close();
});

test('light and dark, 1440x900', async () => {
  await launch('1440x900', 'light');
  await shot('09-list-light-1440x900');
  await page.locator('[data-task-id="SABIN-0004"]').click();
  await shot('10-task-ended-session-light-1440x900');
  await app.close();

  await launch('1440x900', 'dark');
  await page.locator('[data-group="completed"] .group-head').click();
  await shot('11-list-dark-completed-1440x900');
  await app.close();
});

test('review in Rede', async () => {
  await launch('1440x900', 'light');
  await page.locator('[data-task-id="SABIN-0003"]').click();
  await page.locator('[data-workspace="api"]').getByRole('button', { name: 'Review' }).click();
  const title = page.locator('.review-title');
  await expect(title).not.toHaveText('Opening review…', { timeout: 30_000 });
  if (await page.locator('.review-error').count()) {
    await shot('12-review-unavailable-light-1440x900');
    await app.close();
    return;
  }

  // Compose the page and the native review view into one image
  for (let attempt = 0; attempt < 40; attempt++) {
    await page.waitForTimeout(250);
    const probe = await captureReview();
    if (probe && !probe.loading) break;
  }
  await page.waitForTimeout(1200);
  const capture = await captureReview();
  expect(capture).not.toBeNull();
  const base = (await page.screenshot()).toString('base64');
  const composed = await page.evaluate(async ({ base, review }) => {
    const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
    const [under, over] = await Promise.all([load(`data:image/png;base64,${base}`), load(review.dataUrl)]);
    const scale = under.width / window.innerWidth;
    const canvas = document.createElement('canvas');
    canvas.width = under.width;
    canvas.height = under.height;
    const context = canvas.getContext('2d')!;
    context.drawImage(under, 0, 0);
    context.drawImage(over, review.bounds.x * scale, review.bounds.y * scale, review.bounds.width * scale, review.bounds.height * scale);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { base, review: capture! });
  await fs.writeFile(path.join(out!, '12-review-rede-light-1440x900.png'), Buffer.from(composed, 'base64'));
  await app.close();
});

function captureReview(): Promise<{ dataUrl: string; bounds: { x: number; y: number; width: number; height: number }; loading: boolean } | null> {
  return app.evaluate(async () => {
    const hooks = (globalThis as any).__sabinTest;
    return hooks?.captureReview ? hooks.captureReview() : null;
  });
}
