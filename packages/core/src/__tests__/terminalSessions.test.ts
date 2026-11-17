import {
  attributeTerminals,
  chooseJob,
  windowForTask,
  terminalTitle,
  openWorkspaceTab,
  focusTerminal,
  listTaskTerminals
} from '../terminalSessions';
import { TerminalDriver, TerminalSession, OpenTabOptions } from '../terminal/types';
import { ForegroundJob, programName, parseCwds } from '../terminal/processes';
import { currentSessionId, NULL_DRIVER } from '../terminal';
import { AgentSession } from '../agentSessions';
import { Workspace } from '../workspaces';
import { defaultConfig } from '../config';

const ws = (taskId: string, p: string, repo = 'r'): Workspace =>
  ({ taskId, repo, repoPath: `/${repo}`, path: p, branch: `me/${taskId}`, head: null, main: false });

const job = (pid: number, command: string, cwd: string | null, leader = false): ForegroundJob =>
  ({ pid, leader, command, program: programName(command), cwd });

const session = (id: string, windowId: string, tabIndex: number, jobs: ForegroundJob[]): TerminalSession =>
  ({ id, tty: `ttys0${tabIndex}`, windowId, tabIndex, jobs });

/** A driver that records what it was asked and never talks to iTerm2 */
function fakeDriver(sessions: TerminalSession[]) {
  const opened: OpenTabOptions[] = [];
  const focused: string[] = [];
  const driver: TerminalDriver = {
    name: 'fake',
    isAvailable: async () => true,
    listSessions: async () => sessions,
    focus: async id => {
      focused.push(id);
      return sessions.some(s => s.id === id);
    },
    openTab: async options => {
      opened.push(options);
    }
  };
  return { driver, opened, focused };
}

describe('chooseJob', () => {
  it('prefers an agent member, else the leader', () => {
    const shell = job(1, '-zsh', '/a', true);
    const wrapper = job(2, 'bash run.sh', '/a', true);
    const codex = job(3, 'node /usr/local/bin/codex --yolo', '/b');
    expect(chooseJob([wrapper, codex])?.pid).toBe(3);
    expect(chooseJob([shell])?.pid).toBe(1);
    expect(chooseJob([])).toBeNull();
  });
});

describe('attributeTerminals', () => {
  const workspaces = [ws('T-1', '/wt/T-1', 'api'), ws('T-1', '/wt2/T-1', 'web'), ws('T-2', '/wt/T-2')];

  it('groups by the workspace the cwd is in, across repos, agents first', () => {
    const sessions = [
      session('s-shell', 'w1', 1, [job(10, '-zsh', '/wt/T-1/src', true)]),
      session('s-codex', 'w1', 2, [job(11, 'codex', '/wt2/T-1', true)]),
      session('s-other', 'w2', 1, [job(12, 'claude', '/wt/T-2', true)]),
      session('s-none', 'w2', 2, [job(13, '-zsh', '/home', true)]),
      session('s-prefix', 'w2', 3, [job(14, '-zsh', '/wt/T-10', true)])
    ];
    const agent: AgentSession = { sessionId: 'a', agent: 'codex', activity: 'waiting', since: '2026', cwd: '/wt2/T-1', termSessionId: 's-codex' };

    const grouped = attributeTerminals(sessions, workspaces, [agent]);

    expect([...grouped.keys()].sort()).toEqual(['T-1', 'T-2']);
    const t1 = grouped.get('T-1')!;
    expect(t1.map(t => [t.id, t.agent, t.workspace.repo])).toEqual([['s-codex', 'codex', 'web'], ['s-shell', null, 'api']]);
    expect(t1[0].agentSession?.activity).toBe('waiting');
    expect(t1[1].agentSession).toBeNull();
  });

  it('falls back to another group member when the chosen one has no cwd', () => {
    const grouped = attributeTerminals(
      [session('s', 'w', 1, [job(1, 'codex', null, true), job(2, 'node helper.js', '/wt/T-2')])],
      workspaces
    );
    expect(grouped.get('T-2')?.[0].agent).toBe('codex');
  });
});

describe('windowForTask', () => {
  const workspaces = [ws('T-1', '/wt/T-1'), ws('T-2', '/wt/T-2')];
  const shell = (id: string, windowId: string, cwd: string) => session(id, windowId, 1, [job(1, '-zsh', cwd, true)]);

  it('reuses a window the task has to itself', () => {
    const grouped = attributeTerminals([shell('a', 'w1', '/wt/T-1'), shell('b', 'w1', '/home'), shell('c', 'w2', '/wt/T-2')], workspaces);
    expect(windowForTask('T-1', grouped)).toBe('w1');
  });

  it('never reuses a window shared with another task', () => {
    const grouped = attributeTerminals([shell('a', 'w1', '/wt/T-1'), shell('b', 'w1', '/wt/T-2')], workspaces);
    expect(windowForTask('T-1', grouped)).toBeNull();
    expect(windowForTask('T-3', grouped)).toBeNull();
  });
});

describe('opening and focusing, through a fake driver', () => {
  const config = defaultConfig();

  it('opens in the task\'s own window with a title and the task tag', async () => {
    const workspace = ws('T-1', '/wt/T-1');
    const { driver, opened } = fakeDriver([session('a', 'w9', 1, [job(1, '-zsh', '/wt/T-1', true)])]);

    expect(await openWorkspaceTab(config, ['T-1'], workspace, { driver, workspaces: [workspace], command: 'codex resume abc' })).toBe(true);
    expect(opened).toEqual([{
      cwd: '/wt/T-1', command: 'codex resume abc', title: terminalTitle('T-1', 'codex'), windowId: 'w9', newWindow: false, taskId: 'T-1'
    }]);
  });

  it('opens a new window when the task has none', async () => {
    const workspace = ws('T-1', '/wt/T-1');
    const { driver, opened } = fakeDriver([]);
    await openWorkspaceTab(config, ['T-1'], workspace, { driver, workspaces: [workspace] });
    expect(opened[0]).toMatchObject({ newWindow: true, windowId: undefined, title: 'T-1 · shell', command: undefined });
  });

  it('reports false without a terminal', async () => {
    expect(await openWorkspaceTab(config, ['T-1'], ws('T-1', '/x'), { driver: NULL_DRIVER })).toBe(false);
  });

  it('focuses by GUID', async () => {
    const { driver, focused } = fakeDriver([session('GUID-1', 'w', 1, [])]);
    expect(await focusTerminal('GUID-1', driver)).toBe(true);
    expect(await focusTerminal('GUID-2', driver)).toBe(false);
    expect(focused).toEqual(['GUID-1', 'GUID-2']);
  });

  it('lists through the driver', async () => {
    const workspace = ws('T-1', '/wt/T-1');
    const { driver } = fakeDriver([session('a', 'w', 1, [job(1, 'claude', '/wt/T-1', true)])]);
    const grouped = await listTaskTerminals(config, ['T-1'], { driver, workspaces: [workspace] });
    expect(grouped.get('T-1')?.[0].agent).toBe('claude');
  });
});

describe('process helpers', () => {
  it('reads the program behind a runtime and a login shell', () => {
    expect(programName('node /opt/bin/codex --yolo')).toBe('codex');
    expect(programName('-zsh')).toBe('zsh');
    expect(programName('/usr/local/bin/claude')).toBe('claude');
  });

  it('parses partial lsof output', () => {
    expect(parseCwds('p12\nfcwd\nn/a\np13\nfcwd\n')).toEqual(new Map([[12, '/a']]));
  });

  it('reads the GUID out of ITERM_SESSION_ID', () => {
    expect(currentSessionId({ ITERM_SESSION_ID: 'w0t1p0:ABC' })).toBe('ABC');
    expect(currentSessionId({})).toBeNull();
  });
});
