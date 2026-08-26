import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { withLock } from '../lock';

describe('withLock', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-lock-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('returns the callback result and releases the lock', async () => {
    const result = await withLock(testDir, async () => 'done');

    expect(result).toBe('done');
    await expect(fs.access(path.join(testDir, '.lock'))).rejects.toThrow();
  });

  it('releases the lock when the callback throws', async () => {
    await expect(withLock(testDir, async () => {
      throw new Error('boom');
    })).rejects.toThrow('boom');

    await expect(fs.access(path.join(testDir, '.lock'))).rejects.toThrow();
  });

  it('serialises concurrent callers', async () => {
    const order: string[] = [];

    const run = (id: string) => withLock(testDir, async () => {
      order.push(`${id}:enter`);
      await new Promise(resolve => setTimeout(resolve, 20));
      order.push(`${id}:exit`);
    });

    await Promise.all([run('a'), run('b'), run('c')]);

    // Nobody enters before the previous holder has exited
    expect(order).toHaveLength(6);
    for (let i = 0; i < order.length; i += 2) {
      expect(order[i].split(':')[0]).toBe(order[i + 1].split(':')[0]);
    }
  });

  it('times out rather than hanging when the lock is held', async () => {
    await fs.mkdir(path.join(testDir, '.lock'));

    await expect(
      withLock(testDir, async () => 'never', { timeoutMs: 100 })
    ).rejects.toThrow('Timed out waiting for the Sabin lock');
  });

  it('breaks an abandoned lock', async () => {
    await fs.mkdir(path.join(testDir, '.lock'));

    const result = await withLock(testDir, async () => 'recovered', { staleMs: 0 });
    expect(result).toBe('recovered');
  });
});
