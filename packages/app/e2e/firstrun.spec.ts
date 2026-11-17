import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { test, expect, _electron as electron } from '@playwright/test';
import { appEnv, Fixture } from './fixture';

/** No home yet: the first-run screen explains `sabin setup` and can create the home */
test('first run creates the home and teaches the empty list', async () => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-app-firstrun-')));
  const fixture = { home: path.join(root, 'sabin'), userData: path.join(root, 'user-data') } as Fixture;
  const app = await electron.launch({ args: [path.resolve(__dirname, '..')], env: appEnv(fixture) });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: 'Welcome to Sabin' })).toBeVisible();
    await expect(page.locator('.command')).toHaveText('sabin setup --hooks');
    if (process.env.SABIN_APP_SHOTS) await page.screenshot({ path: path.join(process.env.SABIN_APP_SHOTS, '13-first-run-light-1100x720.png') });
    await page.getByRole('button', { name: /^Create / }).click();
    await expect(page.getByRole('heading', { name: 'No tasks yet' })).toBeVisible();
    await expect(page.locator('.side-empty')).toContainText('No repositories yet');
    if (process.env.SABIN_APP_SHOTS) await page.screenshot({ path: path.join(process.env.SABIN_APP_SHOTS, '14-empty-home-light-1100x720.png') });
    expect((await fs.stat(path.join(fixture.home, 'config.json'))).isFile()).toBe(true);
  } finally {
    await app.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
