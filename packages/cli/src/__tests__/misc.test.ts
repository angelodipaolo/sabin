import fs from 'fs/promises';
import path from 'path';
import { Readable } from 'stream';
import { readConfig, readAgentSessions } from '@sabin/core';
import { repoAdd, repoLs, repoRm } from '../commands/repo';
import { app } from '../commands/app';
import { agentState } from '../commands/agent-state';
import { run } from '../program';
import { sandbox, makeRepo, git, Sandbox } from './helpers';

let box: Sandbox;
beforeEach(async () => { box = await sandbox(); });
afterEach(async () => { await box.restore(); });

describe('sabin repo', () => {
  it('adds, lists and removes repos', async () => {
    const repo = await makeRepo(box.root, 'tools');
    await repoAdd(repo);
    expect(box.out()).toContain('Registered tools');
    box.clear();

    // A linked worktree registers its main clone, once
    const tree = path.join(box.root, 'tools-tree');
    await git(repo, 'worktree', 'add', '-q', '-b', 'side', tree);
    await box.inDir(tree, () => repoAdd());
    expect(box.out()).toContain('Already registered as tools');
    box.clear();

    await repoLs();
    expect(box.out()).toMatch(/^NAME\s+PATH/);
    expect(box.out()).toContain(`tools  ${repo}`);
    expect(box.out()).toContain(`worktrees ${path.join(box.root, 'tools-worktrees')}`);
    box.clear();

    await repoRm('tools');
    expect(box.out()).toContain('Unregistered tools');
    expect((await readConfig(box.home)).repos).toEqual({});
    await expect(fs.access(repo)).resolves.toBeUndefined();

    await expect(repoRm('tools')).rejects.toThrow('No registered repo named "tools"');
    await expect(repoAdd(box.root)).rejects.toThrow('Not a git repository');
  });

  it('says how to register one when there are none', async () => {
    await repoLs();
    expect(box.out()).toContain('No repos registered');
  });
});

describe('sabin app', () => {
  it('opens an installed app, passing the task through', async () => {
    const installed = path.join(box.root, 'Sabin.app');
    await fs.mkdir(installed);
    const run = jest.fn();
    await app({ task: 'arch-1234' }, { candidates: [path.join(box.root, 'missing.app'), installed], run });
    expect(run).toHaveBeenCalledWith('open', ['-a', installed, '--args', '--task', 'ARCH-1234']);
    expect(box.out()).toContain(`Opening ${installed} on ARCH-1234`);
  });

  it('falls back to the dev launcher with node', async () => {
    const launcher = path.join(box.root, 'sabin-app.js');
    await fs.writeFile(launcher, '');
    const run = jest.fn();
    await app({}, { candidates: [], launcher, run });
    expect(run).toHaveBeenCalledWith(process.execPath, [launcher]);
  });

  it('says clearly when there is nothing to open', async () => {
    const run = jest.fn();
    await expect(app({}, { candidates: [], launcher: path.join(box.root, 'nope.js'), run }))
      .rejects.toThrow('the dev launcher is missing');
    await expect(app({ task: '../x' }, { candidates: [], run })).rejects.toThrow('Invalid task ID');
    expect(run).not.toHaveBeenCalled();
  });
});

describe('sabin agent-state', () => {
  const quiet = () => {
    expect(box.raw()).toBe('');
    expect(box.out()).toBe('');
    expect(box.err()).toBe('');
  };

  it('records a Claude Code payload and prints nothing', async () => {
    await agentState(Readable.from([JSON.stringify({
      session_id: 'claude-1',
      hook_event_name: 'UserPromptSubmit',
      cwd: box.root,
      transcript_path: path.join(box.userHome, '.claude', 'projects', 'x.jsonl'),
      prompt: 'Fix the bug'
    })]));
    await agentState(Readable.from([JSON.stringify({
      session_id: 'claude-1',
      hook_event_name: 'Notification',
      notification_type: 'permission_prompt',
      cwd: box.root
    })]));
    quiet();

    const [session] = await readAgentSessions(box.home);
    expect(session).toMatchObject({ sessionId: 'claude-1', agent: 'claude', activity: 'waiting', lastPrompt: 'Fix the bug' });
  });

  it('records a Codex Stop payload with its last message and prints nothing', async () => {
    const transcript = path.join(box.userHome, '.codex', 'sessions', 'rollout.jsonl');
    await agentState(Readable.from([JSON.stringify({
      session_id: 'codex-1', hook_event_name: 'UserPromptSubmit', cwd: box.root, transcript_path: transcript, prompt: 'Go'
    })]));
    await agentState(Readable.from([JSON.stringify({
      session_id: 'codex-1',
      hook_event_name: 'Stop',
      cwd: box.root,
      transcript_path: transcript,
      stop_hook_active: false,
      last_assistant_message: 'Done: tests pass.'
    })]));
    quiet();

    const [session] = await readAgentSessions(box.home);
    expect(session).toMatchObject({ sessionId: 'codex-1', agent: 'codex', activity: 'idle', lastMessage: 'Done: tests pass.' });
  });

  it('swallows garbage and empty input without a sound', async () => {
    await agentState(Readable.from(['not json']));
    await agentState(Readable.from([]));
    await agentState(Readable.from([JSON.stringify({ hook_event_name: 'Stop' })]));
    quiet();
    expect(await readAgentSessions(box.home)).toEqual([]);
  });
});

describe('the program', () => {
  it('prints help with no arguments', async () => {
    await run(['node', 'sabin']);
    const help = box.raw();
    expect(help).toContain('Usage: sabin');
    for (const name of ['setup', 'new', 'work', 'ls', 'status [id] <status>', 'context', 'repo', 'app']) {
      expect(help).toContain(name);
    }
    expect(help).not.toContain('agent-state');
  });

  it('reports an error as one line on stderr and a non-zero exit', async () => {
    await run(['node', 'sabin', 'status', 'TASK-1', 'shipped']);
    expect(box.err()).toBe('Unknown status "shipped". Valid statuses: open, ready, in_progress, review, completed');
    expect(process.exitCode).toBe(1);
  });
});
