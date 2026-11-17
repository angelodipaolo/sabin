import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { setTaskStatus } from '@sabin/core';
import { newTask } from '../commands/new';
import { work } from '../commands/work';
import { ls, agentSummary } from '../commands/ls';
import { context, CONTEXT_KEYS } from '../commands/context';
import { agentState } from '../commands/agent-state';
import { sandbox, makeRepo, Sandbox } from './helpers';

let box: Sandbox;
let repo: string;
let tree: string;

beforeEach(async () => {
  box = await sandbox();
  repo = await makeRepo(box.root, 'site');
  await newTask('Redesign the landing page', { project: 'web', id: 'TASK-0001' });
  await newTask('Partition events', { id: 'ARCH-1234', project: 'analytics' });
  await newTask('Old cleanup');
  await setTaskStatus(box.home, 'TASK-0002', 'completed');
  await box.inDir(repo, () => work('TASK-0001'));
  tree = path.join(box.root, 'site-worktrees', 'TASK-0001-redesign-landing-page');
  box.clear();
});
afterEach(async () => { await box.restore(); });

function lines(text: string): string[] {
  return text.split('\n').filter(Boolean);
}

describe('sabin ls', () => {
  it('lists active tasks in aligned columns and hides completed', async () => {
    await ls();
    const rows = lines(box.out());

    expect(rows[0]).toMatch(/^ID\s+STATUS\s+PROJECT\s+TITLE\s+REPOS\s+AGENT$/);
    expect(rows).toHaveLength(4);
    expect(rows[1]).toMatch(/^ARCH-1234\s+open\s+analytics\s+Partition events\s+-$/);
    expect(rows[2]).toMatch(/^TASK-0001\s+open\s+web\s+Redesign the landing page\s+site$/);
    expect(rows[3]).toBe('2 tasks  (completed hidden; --all to show)');
    // Every column starts at the same offset on every row
    const statusColumn = rows[0].indexOf('STATUS');
    expect(rows[1].indexOf('open')).toBe(statusColumn);
    expect(rows[2].indexOf('open')).toBe(statusColumn);
    expect(box.out()).not.toContain('Old cleanup');
  });

  it('filters by --all, --status and --project', async () => {
    await ls({ all: true });
    expect(box.out()).toContain('Old cleanup');
    box.clear();

    await ls({ status: 'completed' });
    expect(lines(box.out())[1]).toMatch(/^TASK-0002\s+completed/);
    box.clear();

    await ls({ project: 'Analytics' });
    expect(box.out()).toContain('ARCH-1234');
    expect(box.out()).not.toContain('TASK-0001');
    box.clear();

    await ls({ project: 'nothing-here' });
    expect(box.out()).toContain('No tasks (completed hidden, project nothing-here).');

    await expect(ls({ status: 'done' })).rejects.toThrow('Unknown status "done". Valid: open, ready');
  });

  it('prints stable JSON with workspaces and agents', async () => {
    const payload = JSON.stringify({
      session_id: 'codex-abc',
      hook_event_name: 'UserPromptSubmit',
      cwd: tree,
      transcript_path: path.join(box.userHome, '.codex', 'sessions', 'x.jsonl'),
      prompt: 'Make it pop'
    });
    await agentState(Readable.from([payload]));

    await ls({ json: true });
    const tasks = JSON.parse(box.out());
    expect(tasks.map((task: any) => task.id)).toEqual(['ARCH-1234', 'TASK-0001']);
    const task = tasks[1];
    expect(Object.keys(task)).toEqual(['id', 'title', 'status', 'project', 'created', 'taskDir', 'workspaces', 'agents']);
    expect(task.workspaces).toEqual([{ repo: 'site', path: tree, branch: 'TASK-0001-redesign-landing-page' }]);
    expect(task.agents).toHaveLength(1);
    expect(task.agents[0]).toMatchObject({ sessionId: 'codex-abc', agent: 'codex', activity: 'busy', cwd: tree });
    expect(Object.keys(task.agents[0])).toEqual(['sessionId', 'agent', 'activity', 'since', 'cwd']);
  });

  it('summarises the agent that most needs you', () => {
    const now = Date.parse('2026-11-16T12:00:00Z');
    const at = (minutes: number) => new Date(now - minutes * 60000).toISOString();
    expect(agentSummary([], now)).toBe('');
    expect(agentSummary([
      { sessionId: 'a', agent: 'claude', activity: 'busy', since: at(1), cwd: '/x' },
      { sessionId: 'b', agent: 'codex', activity: 'waiting', since: at(6), cwd: '/x' },
      { sessionId: 'c', agent: 'codex', activity: 'ended', since: at(60), cwd: '/x' }
    ], now)).toBe('codex waiting 6m +1');
  });
});

describe('sabin context', () => {
  it('returns exactly the planned keys, and never the prompt', async () => {
    await fs.writeFile(path.join(box.home, 'tasks', 'TASK-0001', 'plan.md'), '# Plan\n');
    await fs.writeFile(path.join(box.home, 'tasks', 'TASK-0001', 'research.md'), '# Research\n');

    await box.inDir(tree, () => context(undefined, { json: true }));
    const result = JSON.parse(box.out());

    expect(Object.keys(result)).toEqual([...CONTEXT_KEYS]);
    expect(result).toMatchObject({
      id: 'TASK-0001',
      status: 'open',
      project: 'web',
      home: box.home,
      taskDir: path.join(box.home, 'tasks', 'TASK-0001'),
      plan: path.join(box.home, 'tasks', 'TASK-0001', 'plan.md'),
      log: null,
      notes: [path.join(box.home, 'tasks', 'TASK-0001', 'research.md')],
      workspaces: [{ repo: 'site', path: tree, branch: 'TASK-0001-redesign-landing-page' }],
      workspace: { repo: 'site', path: tree, branch: 'TASK-0001-redesign-landing-page' }
    });
    expect(box.out()).not.toContain('prompt');
  });

  it('takes an explicit ID, with no workspace when the cwd is elsewhere', async () => {
    await box.inDir(repo, () => context('arch-1234', { json: true }));
    const result = JSON.parse(box.out());
    expect(result.id).toBe('ARCH-1234');
    expect(result.workspaces).toEqual([]);
    expect(result.workspace).toBeNull();
  });

  it('prints a short summary without --json', async () => {
    await box.inDir(tree, () => context(undefined));
    const out = box.out();
    expect(out).toContain('TASK-0001  Redesign the landing page');
    expect(out).toContain('Plan:      none');
    expect(out).toContain(`site  TASK-0001-redesign-landing-page  ${tree} (here)`);
    expect(out).not.toContain('prompt');
  });

  it('fails outside a worktree when no ID is given', async () => {
    await expect(box.inDir(repo, () => context(undefined))).rejects.toThrow('Pass the ID: sabin context <id>');
  });
});
