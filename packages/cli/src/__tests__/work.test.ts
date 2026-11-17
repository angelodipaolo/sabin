import fs from 'fs/promises';
import path from 'path';
import { readConfig, writeConfig, listWorkspaces } from '@sabin/core';
import { newTask } from '../commands/new';
import { work } from '../commands/work';
import { repoAdd } from '../commands/repo';
import { sandbox, makeRepo, git, Sandbox } from './helpers';

let box: Sandbox;
let api: string;
let web: string;

beforeEach(async () => {
  box = await sandbox();
  api = await makeRepo(box.root, 'api');
  web = await makeRepo(box.root, 'web');
  await newTask('Add the export button');
  box.clear();
});
afterEach(async () => { await box.restore(); });

async function worktreeCount(repo: string): Promise<number> {
  return (await git(repo, 'worktree', 'list', '--porcelain')).split('\n').filter(line => line.startsWith('worktree ')).length;
}

describe('sabin work', () => {
  it('registers the repo of the cwd and creates the worktree', async () => {
    await box.inDir(api, () => work('TASK-0001'));

    const expected = path.join(box.root, 'api-worktrees', 'TASK-0001-add-export-button');
    expect((await fs.stat(expected)).isDirectory()).toBe(true);
    expect(await git(expected, 'branch', '--show-current')).toBe('TASK-0001-add-export-button');

    const config = await readConfig(box.home);
    expect(config.repos.api.path).toBe(api);

    const out = box.out();
    expect(out).toContain(`Registered repo api  ${api}`);
    expect(out).toContain('Created worktree for TASK-0001 in api');
    expect(out).toContain(expected);
    expect(out).toContain('postCreate: none configured');
  });

  it('is idempotent: a second run reports the worktree and creates nothing', async () => {
    await box.inDir(api, () => work('TASK-0001'));
    box.clear();
    await box.inDir(api, () => work('task-0001'));

    expect(await worktreeCount(api)).toBe(2);
    expect(box.out()).toContain('Worktree already exists for TASK-0001 in api');
    expect(box.out()).not.toContain('Registered');
  });

  it('gives one task a workspace in each of two repos', async () => {
    await box.inDir(api, () => work('TASK-0001'));
    await repoAdd(web);
    box.clear();
    // Run from inside the api worktree: the task is inferred, the repo is named
    const apiTree = path.join(box.root, 'api-worktrees', 'TASK-0001-add-export-button');
    await box.inDir(apiTree, () => work(undefined, { repo: 'web', json: true }));

    const result = JSON.parse(box.out());
    expect(result).toEqual({
      id: 'TASK-0001',
      repo: 'web',
      path: path.join(box.root, 'web-worktrees', 'TASK-0001-add-export-button'),
      branch: 'TASK-0001-add-export-button',
      created: true,
      registered: false,
      postCreate: []
    });

    const workspaces = await listWorkspaces(await readConfig(box.home), ['TASK-0001']);
    expect(workspaces.map(workspace => workspace.repo)).toEqual(['api', 'web']);
  });

  it('uses the branch prefix and runs postCreate, reporting each command', async () => {
    await repoAdd(api);
    const config = await readConfig(box.home);
    config.branch.prefix = 'me';
    config.repos.api.postCreate = ['touch setup-ran', 'echo broken >&2; exit 3', 'touch never'];
    await writeConfig(box.home, config);
    box.clear();

    await box.inDir(api, () => work('TASK-0001'));

    const tree = path.join(box.root, 'api-worktrees', 'TASK-0001-add-export-button');
    expect(await git(tree, 'branch', '--show-current')).toBe('me/TASK-0001-add-export-button');
    await expect(fs.access(path.join(tree, 'setup-ran'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(tree, 'never'))).rejects.toThrow();

    const out = box.out();
    expect(out).toContain('postCreate: ok     touch setup-ran');
    expect(out).toContain('postCreate: failed echo broken >&2; exit 3');
    expect(out).toContain('broken');
    expect(out).toContain('postCreate: skipped touch never');
    expect(box.err()).toContain('postCreate failed');
    expect(process.exitCode).toBe(1);
  });

  it('explains what to do outside a git repo, and refuses unknown repos and tasks', async () => {
    const plain = path.join(box.root, 'plain');
    await fs.mkdir(plain);
    await expect(box.inDir(plain, () => work('TASK-0001'))).rejects.toThrow('Not inside a git repository');
    await expect(box.inDir(api, () => work('TASK-0001', { repo: 'nope' }))).rejects.toThrow('No registered repo named "nope"');
    await expect(box.inDir(api, () => work('TASK-0099'))).rejects.toThrow('Task not found: TASK-0099');
    await expect(box.inDir(api, () => work(undefined))).rejects.toThrow('Pass the ID: sabin work <id>');
  });
});
