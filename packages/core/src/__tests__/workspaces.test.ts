import fs from 'fs/promises';
import path from 'path';
import {
  listWorkspaces,
  workspacesForTask,
  workspaceForPath,
  createWorkspace,
  branchNameFor,
  workspaceGitStatus,
  parseGitStatus
} from '../workspaces';
import { addRepo, readConfig, findRepo, defaultConfig } from '../config';
import { SabinConfig } from '../types';
import { tempDir, makeRepo, addWorktree, git } from './helpers';

let root: string;
let home: string;

beforeEach(async () => {
  root = await tempDir('sabin-workspaces-');
  home = path.join(root, 'home');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function register(...repos: string[]): Promise<SabinConfig> {
  for (const repo of repos) await addRepo(home, repo);
  const config = await readConfig(home);
  config.branch.prefix = 'me';
  return config;
}

describe('discovery', () => {
  it('finds a task\'s worktrees across two repos, and keeps ARCH-12 and ARCH-123 apart', async () => {
    const api = await makeRepo(root, 'api');
    const web = await makeRepo(root, 'web');
    const apiArch12 = await addWorktree(api, path.join(root, 'api-worktrees', 'ARCH-12-x'), 'me/ARCH-12-x');
    const webArch12 = await addWorktree(web, path.join(root, 'web-worktrees', 'ARCH-12-x'), 'me/arch-12-x');
    const webArch123 = await addWorktree(web, path.join(root, 'web-worktrees', 'ARCH-123-y'), 'me/ARCH-123-y');
    await addWorktree(web, path.join(root, 'web-worktrees', 'other'), 'me/unrelated');
    const config = await register(api, web);

    const all = await listWorkspaces(config, ['ARCH-12', 'ARCH-123', 'ARCH-999']);
    expect(all.map(w => [w.taskId, w.repo, w.path])).toEqual([
      ['ARCH-12', 'api', apiArch12],
      ['ARCH-12', 'web', webArch12],
      ['ARCH-123', 'web', webArch123]
    ]);
    expect(all[0]).toMatchObject({ branch: 'me/ARCH-12-x', repoPath: api, main: false });
    expect(all[0].head).toMatch(/^[0-9a-f]{40}$/);

    // With only ARCH-12 known, ARCH-123's branch is not mistaken for it
    expect((await workspacesForTask(config, 'arch-12')).map(w => w.path)).toEqual([apiArch12, webArch12]);
  });

  it('tolerates a registered repo whose path is gone', async () => {
    const live = await makeRepo(root, 'live');
    const doomed = await makeRepo(root, 'doomed');
    await addWorktree(live, path.join(root, 'live-worktrees', 'T-1'), 'me/T-1');
    const config = await register(live, doomed);
    await fs.rm(doomed, { recursive: true, force: true });

    expect((await listWorkspaces(config, ['T-1'])).map(w => w.repo)).toEqual(['live']);
  });

  it('skips worktrees whose directory was deleted', async () => {
    const repo = await makeRepo(root, 'r');
    const gone = await addWorktree(repo, path.join(root, 'r-worktrees', 'T-1'), 'me/T-1');
    await fs.rm(gone, { recursive: true, force: true });
    expect(await listWorkspaces(await register(repo), ['T-1'])).toEqual([]);
  });

  it('counts the main clone when it is on a task branch', async () => {
    const repo = await makeRepo(root, 'r');
    await git(repo, 'checkout', '-q', '-b', 'me/T-5-direct');
    const [workspace] = await listWorkspaces(await register(repo), ['T-5']);
    expect(workspace).toMatchObject({ taskId: 'T-5', path: repo, main: true });
  });

  it('maps a path to its workspace, from deep inside it', async () => {
    const repo = await makeRepo(root, 'r');
    const worktree = await addWorktree(repo, path.join(root, 'r-worktrees', 'T-1-x'), 'me/T-1-x');
    await fs.mkdir(path.join(worktree, 'deep', 'er'), { recursive: true });
    const config = await register(repo);

    expect((await workspaceForPath(config, ['T-1'], path.join(worktree, 'deep', 'er')))?.path).toBe(worktree);
    expect(await workspaceForPath(config, ['T-1'], repo)).toBeNull();
    expect(await workspaceForPath(config, ['T-2'], worktree)).toBeNull();
    expect(await workspaceForPath(config, ['T-1'], root)).toBeNull();
  });
});

describe('createWorkspace', () => {
  it('creates the branch and worktree, runs postCreate, and is idempotent', async () => {
    const repo = await makeRepo(root, 'app');
    await addRepo(home, repo);
    const config = await readConfig(home);
    config.branch.prefix = 'me';
    config.repos.app.postCreate = ['echo hello > made.txt', 'false', 'echo never > never.txt'];
    const task = { id: 'SABIN-0025', title: 'Command center for the agents' };

    const first = await createWorkspace(config, task, findRepo(config, 'app')!);
    const expected = path.join(root, 'app-worktrees', 'SABIN-0025-command-center-agents');
    expect(first.created).toBe(true);
    expect(first.workspace).toMatchObject({ taskId: 'SABIN-0025', repo: 'app', path: expected, branch: 'me/SABIN-0025-command-center-agents' });
    expect(first.postCreate.map(result => [result.command, result.ok])).toEqual([
      ['echo hello > made.txt', true],
      ['false', false]
    ]);
    expect(await fs.readFile(path.join(expected, 'made.txt'), 'utf8')).toBe('hello\n');

    // A retitled task still finds its workspace: the branch is the record
    const second = await createWorkspace(config, { ...task, title: 'Renamed' }, findRepo(config, 'app')!);
    expect(second).toEqual({ workspace: first.workspace, created: false, postCreate: [] });
    expect((await listWorkspaces(config, ['SABIN-0025']))).toHaveLength(1);
  });

  it('refuses to create over an existing directory', async () => {
    const repo = await makeRepo(root, 'app');
    const config = await register(repo);
    await fs.mkdir(path.join(root, 'app-worktrees', 'T-1'), { recursive: true });
    await expect(createWorkspace(config, { id: 'T-1', title: '' }, findRepo(config, 'app')!))
      .rejects.toMatchObject({ code: 'WORKSPACE_PATH_TAKEN' });
  });

  it('names branches from the template', () => {
    const config = { ...defaultConfig(), branch: { prefix: 'me' } };
    expect(branchNameFor(config, 'T-1', 'slug')).toBe('me/T-1-slug');
    expect(branchNameFor(config, 'T-1', null)).toBe('me/T-1');
    expect(branchNameFor(defaultConfig(), 'T-1', 'slug')).toBe('T-1-slug');
    expect(branchNameFor({ ...config, branch: { prefix: 'me', template: 'feature/{id}' } }, 'T-1', 'x')).toBe('feature/T-1');
  });
});

describe('workspaceGitStatus', () => {
  it('reports branch, dirt and upstream distance', async () => {
    const repo = await makeRepo(root, 'origin');
    const clone = path.join(root, 'clone');
    await git(root, 'clone', '-q', repo, clone);
    await fs.writeFile(path.join(clone, 'new.txt'), 'x');
    await fs.writeFile(path.join(clone, 'README.md'), 'changed');

    expect(await workspaceGitStatus(clone)).toEqual({ branch: 'main', dirty: 2, upstream: 'origin/main', ahead: 0, behind: 0 });

    await git(clone, 'add', '.');
    await git(clone, 'commit', '-q', '-m', 'local');
    expect(await workspaceGitStatus(clone)).toMatchObject({ dirty: 0, ahead: 1, behind: 0 });
  });

  it('has no upstream on a fresh branch, and is null outside git', async () => {
    const repo = await makeRepo(root, 'r');
    expect(await workspaceGitStatus(repo)).toEqual({ branch: 'main', dirty: 0, upstream: null, ahead: null, behind: null });
    expect(await workspaceGitStatus(path.join(root, 'missing'))).toBeNull();
  });

  it('parses a detached head', () => {
    expect(parseGitStatus('# branch.oid abc\n# branch.head (detached)\n? x\n').branch).toBeNull();
  });
});
