import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { readConfig, writeConfig, defaultConfig, addRepo, removeRepo, listRepos, repoForPath, findRepo, setRepoProject } from '../config';
import { resolveHome, ensureHome, homePaths } from '../home';
import { readHook, findHook, hookPath } from '../hooks';
import { tempDir, makeRepo, addWorktree } from './helpers';

let root: string;
let home: string;

beforeEach(async () => {
  root = await tempDir('sabin-config-');
  home = path.join(root, 'home');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('home', () => {
  it('resolves SABIN_HOME, else ~/sabin', () => {
    expect(resolveHome({ SABIN_HOME: '/tmp/x' })).toBe('/tmp/x');
    expect(resolveHome({ SABIN_HOME: '~/elsewhere' })).toBe(path.join(os.homedir(), 'elsewhere'));
    expect(resolveHome({})).toBe(path.join(os.homedir(), 'sabin'));
  });

  it('creates the layout and a default config once', async () => {
    const created = await ensureHome(home);
    const paths = homePaths(home);
    expect(created).toEqual(expect.arrayContaining([home, paths.tasksDir, paths.projectsDir, paths.hooksDir, paths.sessionsDir, paths.configFile]));
    expect(await readConfig(home)).toEqual(defaultConfig());
    expect(await ensureHome(home)).toEqual([]);
  });
});

describe('readConfig', () => {
  it('is defaults when missing', async () => {
    expect(await readConfig(home)).toEqual(defaultConfig());
  });

  it('layers the file over the defaults', async () => {
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, 'config.json'), JSON.stringify({ idPrefix: 'SABIN', branch: { prefix: 'angelo' } }));
    const config = await readConfig(home);
    expect(config.idPrefix).toBe('SABIN');
    expect(config.idPadding).toBe(4);
    expect(config.branch).toEqual({ prefix: 'angelo', template: '{prefix}/{id}-{slug}' });
    expect(config.repos).toEqual({});
  });

  it('throws on an unparsable file', async () => {
    await fs.mkdir(home, { recursive: true });
    await fs.writeFile(path.join(home, 'config.json'), '{ "idPrefix": "X", }');
    await expect(readConfig(home)).rejects.toThrow('Could not parse');
  });
});

describe('repo registry', () => {
  it('registers a repo by any path inside it, once', async () => {
    const repo = await makeRepo(root, 'sabin');
    await fs.mkdir(path.join(repo, 'src'));

    const first = await addRepo(home, path.join(repo, 'src'));
    expect(first).toMatchObject({ added: true, repo: { name: 'sabin', path: repo, worktreesRoot: path.join(root, 'sabin-worktrees') } });

    const again = await addRepo(home, repo);
    expect(again.added).toBe(false);
    expect(listRepos(await readConfig(home))).toHaveLength(1);
  });

  it('registers the main clone when given a linked worktree', async () => {
    const repo = await makeRepo(root, 'app');
    const worktree = await addWorktree(repo, path.join(root, 'app-worktrees', 'X-1'), 'me/X-1');
    expect((await addRepo(home, worktree)).repo.path).toBe(repo);
  });

  it('suffixes a colliding name', async () => {
    const a = await makeRepo(path.join(root, 'one'), 'web');
    const b = await makeRepo(path.join(root, 'two'), 'web');
    const c = await makeRepo(path.join(root, 'three'), 'web');
    await addRepo(home, a);
    expect((await addRepo(home, b)).repo.name).toBe('web-2');
    expect((await addRepo(home, c)).repo.name).toBe('web-3');
  });

  it('refuses a directory outside git', async () => {
    await expect(addRepo(home, root)).rejects.toMatchObject({ code: 'NOT_A_GIT_REPO' });
  });

  it('removes by name', async () => {
    const repo = await makeRepo(root, 'gone');
    await addRepo(home, repo);
    expect((await removeRepo(home, 'gone')).path).toBe(repo);
    expect(listRepos(await readConfig(home))).toEqual([]);
    await expect(removeRepo(home, 'gone')).rejects.toMatchObject({ code: 'REPO_NOT_FOUND' });
  });

  it('resolves worktreesRoot relative to the repo, and keeps postCreate', async () => {
    const config = { ...defaultConfig(), repos: { a: { path: '/r/a', worktreesRoot: '.worktrees', postCreate: ['npm ci'] }, broken: {} as any } };
    expect(listRepos(config)).toEqual([{ name: 'a', path: '/r/a', worktreesRoot: '/r/a/.worktrees', postCreate: ['npm ci'], project: null }]);
    expect(findRepo(config, 'broken')).toBeNull();
  });

  it('knows which repo a directory is in, worktrees included', async () => {
    const repo = await makeRepo(root, 'svc');
    const elsewhere = await addWorktree(repo, path.join(root, 'anywhere', 'X-2'), 'me/X-2');
    const other = await makeRepo(root, 'unregistered');
    await addRepo(home, repo);
    const config = await readConfig(home);

    expect((await repoForPath(config, repo))?.name).toBe('svc');
    expect((await repoForPath(config, elsewhere))?.name).toBe('svc');
    expect(await repoForPath(config, other)).toBeNull();
    expect(await repoForPath(config, root)).toBeNull();
  });

  it('sets, normalises and clears a default project, keeping the rest of the entry', async () => {
    const repo = await makeRepo(root, 'game');
    const added = await addRepo(home, repo, { project: 'Game Explorer' });
    expect(added).toMatchObject({ added: true, repo: { name: 'game', project: 'game-explorer' } });

    // Registering again with a project updates the default
    const again = await addRepo(home, repo, { project: 'other' });
    expect(again).toMatchObject({ added: false, repo: { project: 'other' } });
    expect((await addRepo(home, repo)).repo.project).toBe('other');

    const config = await readConfig(home);
    config.repos.game.postCreate = ['npm ci'];
    await writeConfig(home, config);

    expect((await setRepoProject(home, 'game', 'arcade')).project).toBe('arcade');
    expect((await readConfig(home)).repos.game).toEqual({ path: repo, postCreate: ['npm ci'], project: 'arcade' });
    expect((await setRepoProject(home, 'game', null)).project).toBeNull();
    expect((await readConfig(home)).repos.game).toEqual({ path: repo, postCreate: ['npm ci'] });

    await expect(setRepoProject(home, 'gone', 'x')).rejects.toMatchObject({ code: 'REPO_NOT_FOUND' });
    await expect(setRepoProject(home, 'game', '!!')).rejects.toMatchObject({ code: 'INVALID_PROJECT' });
    await expect(addRepo(home, repo, { project: '' })).rejects.toMatchObject({ code: 'INVALID_PROJECT' });
  });

  it('writes config atomically and readably', async () => {
    await writeConfig(home, { ...defaultConfig(), idPrefix: 'Q' });
    expect((await readConfig(home)).idPrefix).toBe('Q');
    expect(await fs.readdir(home)).toEqual(['config.json']);
  });
});

describe('hooks', () => {
  it('prefers the per-repo hook, falls back to the global one', async () => {
    await fs.mkdir(path.join(home, 'hooks', 'sabin'), { recursive: true });
    await fs.writeFile(hookPath(home, 'completed'), 'Global\n');
    await fs.writeFile(hookPath(home, 'completed', 'sabin'), 'Sabin only\n');
    await fs.writeFile(hookPath(home, 'review', 'sabin'), '   \n');

    expect(await readHook(home, 'completed', 'sabin')).toBe('Sabin only');
    expect(await readHook(home, 'completed', 'other')).toBe('Global');
    expect(await readHook(home, 'completed')).toBe('Global');
    expect(await readHook(home, 'review', 'sabin')).toBeNull();
    expect(await readHook(home, 'ready')).toBeNull();
  });

  it('reports which file a hook came from', async () => {
    await fs.mkdir(path.join(home, 'hooks', 'sabin'), { recursive: true });
    await fs.writeFile(hookPath(home, 'completed'), 'Global\n');
    await fs.writeFile(hookPath(home, 'completed', 'sabin'), 'Sabin only\n');

    expect(await findHook(home, 'completed', 'sabin')).toEqual({ file: hookPath(home, 'completed', 'sabin'), text: 'Sabin only' });
    expect(await findHook(home, 'completed', 'other')).toEqual({ file: hookPath(home, 'completed'), text: 'Global' });
    expect(await findHook(home, 'ready')).toBeNull();
  });

  it('never lets a repo name escape the hooks directory', () => {
    expect(hookPath(home, 'completed', '..')).toBe(path.join(home, 'hooks', 'completed.md'));
    expect(hookPath(home, 'completed', '../x')).toBe(path.join(home, 'hooks', 'completed.md'));
  });
});
