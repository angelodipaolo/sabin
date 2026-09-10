import {
  groupSessionsByTicket,
  chooseJob,
  stepFromCommand,
  windowForTicket,
  sessionTitle,
  TicketSession
} from '../sessions';
import { programName, parseCwds } from '../terminal/processes';
import { currentSessionId } from '../terminal';
import { TerminalSession } from '../terminal/types';
import { ForegroundJob } from '../terminal/processes';
import { WorktreeInfo } from '../git';
import { SabinConfig } from '../types';

const config: SabinConfig = { projectPrefix: 'SABIN', taskNumberPadding: 4 };

const MAIN = '/repo';
const WT_17 = '/repo-worktrees/SABIN-0017-tabs';
const WT_20 = '/repo-worktrees/SABIN-0020-review';

const worktrees: WorktreeInfo[] = [
  { path: MAIN, branch: 'main', detached: false, bare: false },
  { path: WT_17, branch: 'angelo/SABIN-0017-tabs', detached: false, bare: false },
  { path: WT_20, branch: 'angelo/SABIN-0020-review', detached: false, bare: false }
];

function job(overrides: Partial<ForegroundJob> = {}): ForegroundJob {
  return {
    pid: 1,
    leader: true,
    command: '-zsh',
    program: 'zsh',
    cwd: WT_17,
    ...overrides
  };
}

function session(overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id: 's1',
    tty: 'ttys001',
    windowId: 'w1',
    tabIndex: 1,
    jobs: [job()],
    ...overrides
  };
}

describe('groupSessionsByTicket', () => {
  it('attributes a session to the ticket whose worktree it is in', () => {
    const grouped = groupSessionsByTicket([session()], worktrees, config);

    expect([...grouped.keys()]).toEqual(['SABIN-0017']);
    expect(grouped.get('SABIN-0017')![0].worktree).toBe(WT_17);
  });

  it('counts a subdirectory of the worktree', () => {
    const deep = session({ jobs: [job({ cwd: `${WT_17}/packages/core` })] });

    expect([...groupSessionsByTicket([deep], worktrees, config).keys()]).toEqual(['SABIN-0017']);
  });

  it('drops sessions in the main clone', () => {
    const inMain = session({ jobs: [job({ cwd: MAIN })] });

    expect(groupSessionsByTicket([inMain], worktrees, config).size).toBe(0);
  });

  it('drops sessions outside every worktree', () => {
    const elsewhere = session({ jobs: [job({ cwd: '/Users/angelo' })] });

    expect(groupSessionsByTicket([elsewhere], worktrees, config).size).toBe(0);
  });

  it('drops sessions whose cwd could not be read', () => {
    const unknown = session({ jobs: [job({ cwd: null })] });

    expect(groupSessionsByTicket([unknown], worktrees, config).size).toBe(0);
  });

  it('ignores worktrees whose branch names no ticket', () => {
    const noTicket = [{ path: '/repo-worktrees/spike', branch: 'spike', detached: false, bare: false }];
    const inSpike = session({ jobs: [job({ cwd: '/repo-worktrees/spike' })] });

    expect(groupSessionsByTicket([inSpike], noTicket, config).size).toBe(0);
  });

  it('gives the deepest worktree the session when roots nest', () => {
    const nested = [
      ...worktrees,
      { path: `${WT_17}/vendor/SABIN-0020-review`, branch: 'angelo/SABIN-0020-review', detached: false, bare: false }
    ];
    const inNested = session({ jobs: [job({ cwd: `${WT_17}/vendor/SABIN-0020-review/src` })] });

    expect([...groupSessionsByTicket([inNested], nested, config).keys()]).toEqual(['SABIN-0020']);
  });

  it('classifies a plain shell as a shell', () => {
    const [found] = groupSessionsByTicket([session()], worktrees, config).get('SABIN-0017')!;

    expect(found.role).toBe('shell');
    expect(found.agent).toBeNull();
  });

  it('classifies a known agent, and reads back the step it was launched with', () => {
    const agent = session({
      jobs: [job({
        program: 'claude',
        command: 'claude --dangerously-skip-permissions Follow the sabin skill: implement SABIN-0017'
      })]
    });

    const [found] = groupSessionsByTicket([agent], worktrees, config).get('SABIN-0017')!;

    expect(found.role).toBe('agent');
    expect(found.agent).toBe('claude');
    expect(found.step).toBe('implement');
  });

  it('attributes by any member of the group, not only the chosen one', () => {
    // `sabin implement` is often run from the main clone and launches the
    // agent in the worktree
    const launched = session({
      jobs: [
        job({ pid: 1, leader: true, program: 'sabin', command: 'node /usr/local/bin/sabin implement SABIN-0020', cwd: MAIN }),
        job({ pid: 2, leader: false, program: 'claude', command: 'claude Follow the sabin skill: implement SABIN-0020', cwd: WT_20 })
      ]
    });

    const grouped = groupSessionsByTicket([launched], worktrees, config);

    expect([...grouped.keys()]).toEqual(['SABIN-0020']);
    expect(grouped.get('SABIN-0020')![0].agent).toBe('claude');
  });

  it('sorts agents above shells', () => {
    const shell = session({ id: 'shell', tabIndex: 1 });
    const agent = session({ id: 'agent', tabIndex: 9, jobs: [job({ program: 'codex', command: 'codex' })] });

    const found = groupSessionsByTicket([shell, agent], worktrees, config).get('SABIN-0017')!;

    expect(found.map(s => s.id)).toEqual(['agent', 'shell']);
  });

  it('groups several sessions under one ticket', () => {
    const sessions = [
      session({ id: 'a', tabIndex: 1 }),
      session({ id: 'b', tabIndex: 2 }),
      session({ id: 'c', tabIndex: 1, jobs: [job({ cwd: WT_20 })] })
    ];

    const grouped = groupSessionsByTicket(sessions, worktrees, config);

    expect(grouped.get('SABIN-0017')!.map(s => s.id)).toEqual(['a', 'b']);
    expect(grouped.get('SABIN-0020')!.map(s => s.id)).toEqual(['c']);
  });

  it('recognises an agent added by config', () => {
    const custom = { ...config, agents: { definitions: { aider: { command: 'aider' } } } };
    const agent = session({ jobs: [job({ program: 'aider', command: 'aider' })] });

    expect(groupSessionsByTicket([agent], worktrees, custom).get('SABIN-0017')![0].agent).toBe('aider');
  });
});

describe('chooseJob', () => {
  it('prefers the agent over the sabin process that launched it', () => {
    const jobs = [
      job({ pid: 1, leader: true, program: 'sabin' }),
      job({ pid: 2, leader: false, program: 'claude' })
    ];

    expect(chooseJob(jobs, config)!.program).toBe('claude');
  });

  it("prefers the agent over the agent's own children", () => {
    const jobs = [
      job({ pid: 1, leader: true, program: 'claude' }),
      job({ pid: 2, leader: false, program: 'mcpbridge' })
    ];

    expect(chooseJob(jobs, config)!.program).toBe('claude');
  });

  it('falls back to the leader when no agent is running', () => {
    const jobs = [job({ pid: 1, leader: true, program: 'zsh' }), job({ pid: 2, leader: false, program: 'vim' })];

    expect(chooseJob(jobs, config)!.program).toBe('zsh');
  });

  it('has no answer for an empty group', () => {
    expect(chooseJob([], config)).toBeNull();
  });
});

describe('programName', () => {
  it('strips the login shell dash', () => {
    expect(programName('-zsh')).toBe('zsh');
  });

  it('takes the basename of a path', () => {
    expect(programName('/usr/local/bin/codex --yolo')).toBe('codex');
  });

  it('looks past a runtime to the script it is running', () => {
    expect(programName('node /usr/local/bin/codex --yolo')).toBe('codex');
    expect(programName('node /usr/local/bin/sabin implement SABIN-0017')).toBe('sabin');
  });

  it('ignores the runtime flags on the way', () => {
    expect(programName('node --enable-source-maps /usr/local/bin/sabin')).toBe('sabin');
  });

  it('keeps the runtime when it is running nothing else', () => {
    expect(programName('node')).toBe('node');
  });
});

describe('stepFromCommand', () => {
  it('reads the step out of a composed prompt', () => {
    expect(stepFromCommand('claude Follow the sabin skill: review SABIN-0017')).toBe('review');
  });

  it('has no step for an agent started by hand', () => {
    expect(stepFromCommand('claude --dangerously-skip-permissions')).toBeNull();
  });

  it('refuses a word that is not a workflow step', () => {
    expect(stepFromCommand('claude Follow the sabin skill: ponder SABIN-0017')).toBeNull();
  });

  it('has no step without a command line', () => {
    expect(stepFromCommand(null)).toBeNull();
  });
});

describe('currentSessionId', () => {
  it('takes the uuid, not the position that precedes it', () => {
    expect(currentSessionId({ ITERM_SESSION_ID: 'w7t2p0:29EDDE49-4DBA' })).toBe('29EDDE49-4DBA');
  });

  it('accepts a bare id', () => {
    expect(currentSessionId({ ITERM_SESSION_ID: '29EDDE49-4DBA' })).toBe('29EDDE49-4DBA');
  });

  it('is null outside iTerm2', () => {
    expect(currentSessionId({})).toBeNull();
  });
});

describe('parseCwds', () => {
  it('reads a working directory per pid', () => {
    const cwds = parseCwds('p100\nfcwd\nn/repo\np200\nfcwd\nn/repo-worktrees/SABIN-0017-tabs\n');

    expect(cwds.get(100)).toBe('/repo');
    expect(cwds.get(200)).toBe('/repo-worktrees/SABIN-0017-tabs');
  });

  it('keeps what lsof printed before it gave up', () => {
    // lsof exits non-zero when any pid in the list has already exited - a
    // pipeline's grep and cut are foreground processes that live for
    // milliseconds - but the rows for the live ones are still on stdout.
    // Discarding them dropped every session from the listing.
    expect(parseCwds('p100\nfcwd\nn/repo\np200\n').get(100)).toBe('/repo');
  });

  it('has nothing to say about empty output', () => {
    expect(parseCwds('').size).toBe(0);
  });
});

describe('windowForTicket', () => {
  function inWindow(ticket: string, windowId: string): TicketSession {
    return {
      ...session({ windowId, id: `${ticket}-${windowId}-${Math.random()}` }),
      ticket,
      worktree: WT_17,
      role: 'shell',
      agent: null,
      step: null,
      job: job(),
      cwd: WT_17,
      activity: null,
      activitySince: null
    };
  }

  const map = (...sessions: TicketSession[]): Map<string, TicketSession[]> => {
    const grouped = new Map<string, TicketSession[]>();
    for (const s of sessions) {
      grouped.set(s.ticket, [...(grouped.get(s.ticket) ?? []), s]);
    }
    return grouped;
  };

  it('has no window for a ticket with nothing open', () => {
    expect(windowForTicket('SABIN-0017', new Map())).toBeNull();
  });

  it('is the window the ticket already has to itself', () => {
    const grouped = map(inWindow('SABIN-0017', 'w1'), inWindow('SABIN-0017', 'w1'));

    expect(windowForTicket('SABIN-0017', grouped)).toBe('w1');
  });

  it('refuses a window it shares with another ticket', () => {
    // The flat one-window-for-everything case: reusing it would keep every
    // new tab in the layout this ticket exists to replace
    const grouped = map(inWindow('SABIN-0017', 'w1'), inWindow('SABIN-0020', 'w1'));

    expect(windowForTicket('SABIN-0017', grouped)).toBeNull();
  });

  it('takes the exclusive window over the busier shared one', () => {
    const grouped = map(
      inWindow('SABIN-0017', 'shared'),
      inWindow('SABIN-0017', 'shared'),
      inWindow('SABIN-0017', 'mine'),
      inWindow('SABIN-0020', 'shared')
    );

    expect(windowForTicket('SABIN-0017', grouped)).toBe('mine');
  });

  it('picks the window holding most of them when several are exclusive', () => {
    const grouped = map(
      inWindow('SABIN-0017', 'w1'),
      inWindow('SABIN-0017', 'w2'),
      inWindow('SABIN-0017', 'w2')
    );

    expect(windowForTicket('SABIN-0017', grouped)).toBe('w2');
  });

  it('lets the layout migrate one ticket at a time', () => {
    // Everything starts in one window; each ticket's next tab goes somewhere
    // new, and once a ticket has its own window it keeps it
    const flat = map(inWindow('SABIN-0017', 'flat'), inWindow('SABIN-0020', 'flat'));
    expect(windowForTicket('SABIN-0017', flat)).toBeNull();

    const migrated = map(
      inWindow('SABIN-0017', 'flat'),
      inWindow('SABIN-0017', 'new'),
      inWindow('SABIN-0020', 'flat')
    );
    expect(windowForTicket('SABIN-0017', migrated)).toBe('new');
  });
});

describe('sessionTitle', () => {
  it('reads ticket first, role second', () => {
    expect(sessionTitle('SABIN-0017', 'claude')).toBe('SABIN-0017 · claude');
  });
});

describe('cross-ticket attribution', () => {
  it("files a --here agent under the ticket it is in, not the one it was launched from", () => {
    // `sabin implement SABIN-0020 --here` typed in SABIN-0017's worktree: the
    // leader is the launcher you left behind, the agent is where you now are
    const launched = session({
      jobs: [
        job({ pid: 1, leader: true, program: 'sabin', command: 'node /usr/local/bin/sabin implement SABIN-0020 --here', cwd: WT_17 }),
        job({ pid: 2, leader: false, program: 'claude', command: 'claude Follow the sabin skill: implement SABIN-0020', cwd: WT_20 })
      ]
    });

    const grouped = groupSessionsByTicket([launched], worktrees, config);

    expect([...grouped.keys()]).toEqual(['SABIN-0020']);
    expect(grouped.get('SABIN-0020')![0].agent).toBe('claude');
  });

  it('still falls back to another member when the agent has no readable cwd', () => {
    const launched = session({
      jobs: [
        job({ pid: 1, leader: true, program: 'sabin', command: 'node /usr/local/bin/sabin implement SABIN-0020', cwd: WT_20 }),
        job({ pid: 2, leader: false, program: 'claude', command: 'claude', cwd: null })
      ]
    });

    expect([...groupSessionsByTicket([launched], worktrees, config).keys()]).toEqual(['SABIN-0020']);
  });
});
