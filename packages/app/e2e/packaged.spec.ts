import path from 'path';
import { test, expect, _electron as electron } from '@playwright/test';
import { appEnv, buildFixture } from './fixture';

/**
 * Starts the packaged Sabin.app against a fixture home and quits it. Runs
 * only after `npm run package`, when SABIN_APP_PACKAGED=1.
 */
test.skip(process.env.SABIN_APP_PACKAGED !== '1', 'Set SABIN_APP_PACKAGED=1 after npm run package');

test('the packaged app starts and shows the attention list', async () => {
  const fixture = await buildFixture();
  const executablePath = path.resolve(__dirname, '../release/mac-arm64/Sabin.app/Contents/MacOS/Sabin');
  const app = await electron.launch({ executablePath, args: [], env: appEnv(fixture) });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('[data-group="needs-you"] [data-task-id]').first()).toHaveAttribute('data-task-id', 'SABIN-0001');
    expect(await app.evaluate(({ app: electronApp }) => electronApp.isPackaged)).toBe(true);
  } finally {
    await app.close();
    await fixture.cleanup();
  }
});
