import { expect, it, vi } from 'vitest';
import { getTask, setTaskStatus } from '@sabin/core';
import { buildFixture } from '../e2e/fixture';
import { takeSnapshot } from '../src/main/snapshot';
import { SnapshotCache } from '../src/main/snapshotCache';

const git = vi.hoisted(() => ({ wait: undefined as (() => Promise<void>) | undefined }));

vi.mock('@sabin/core', async importOriginal => {
  const core = await importOriginal<typeof import('@sabin/core')>();
  return {
    ...core,
    workspaceGitStatus: async (dir: string) => {
      await git.wait?.();
      return core.workspaceGitStatus(dir);
    }
  };
});

it('publishes a saved status before Git finishes and rejects the older snapshot', async () => {
  const fixture = await buildFixture();
  let release!: () => void;
  let pending: ReturnType<typeof takeSnapshot> | undefined;
  try {
    const cache = new SnapshotCache();
    const initial = cache.beginRefresh();
    cache.finishRefresh(await takeSnapshot(fixture.home, initial.version, false), initial.revision);
    const original = cache.current!;
    const open = original.projects.find(project => project.slug === 'command-center')!.open;

    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    git.wait = async () => { entered(); await gate; };
    const older = cache.beginRefresh();
    pending = takeSnapshot(fixture.home, older.version, false);
    await started;

    const task = await setTaskStatus(fixture.home, 'SABIN-0001', 'completed');
    const updated = cache.setTaskStatus(task.id, task.status)!;
    expect(updated.tasks.find(task => task.id === 'SABIN-0001')!.status).toBe('completed');
    expect(updated.projects.find(project => project.slug === 'command-center')!.open).toBe(open - 1);
    expect(updated.version).toBeGreaterThan(older.version);
    expect(original.tasks.find(task => task.id === 'SABIN-0001')!.status).toBe('in_progress');

    git.wait = undefined;
    release();
    const stale = await pending;
    expect(stale.tasks.find(task => task.id === 'SABIN-0001')!.status).toBe('in_progress');
    expect(cache.finishRefresh(stale, older.revision)).toBe(false);
    expect(cache.current).toBe(updated);
    expect((await getTask(fixture.home, 'SABIN-0001')).status).toBe('completed');

    const fresh = cache.beginRefresh();
    expect(cache.finishRefresh(await takeSnapshot(fixture.home, fresh.version, false), fresh.revision)).toBe(true);
    expect(cache.current!.tasks.find(task => task.id === 'SABIN-0001')!.status).toBe('completed');

    cache.setTaskStatus('SABIN-0001', 'completed');
    expect(cache.current!.projects.find(project => project.slug === 'command-center')!.open).toBe(open - 1);
    cache.setTaskStatus('SABIN-0001', 'in_progress');
    expect(cache.current!.projects.find(project => project.slug === 'command-center')!.open).toBe(open);
  } finally {
    git.wait = undefined;
    release?.();
    await pending;
    await fixture.cleanup();
  }
});
