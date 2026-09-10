import { DetailTreeProvider, DetailNode } from '../providers/detailProvider';
import { WorkspaceService, TaskWorkspace } from '../services/workspaceService';

jest.mock('vscode');

const workspace = (overrides: Partial<TaskWorkspace> = {}): TaskWorkspace => ({
  ticket: 'SABIN-0022',
  name: 'SABIN-0022-redesign',
  title: 'Redesign the UI',
  status: 'in_progress',
  slug: 'redesign',
  taskFile: '/sabin/tasks/open/SABIN-0022.md',
  notesDir: '/sabin/notes/SABIN-0022-redesign',
  promptFile: '/sabin/prompts/SABIN-0022-redesign.md',
  worktreeDir: '/repo-worktrees/SABIN-0022-redesign',
  branch: 'angelo/SABIN-0022-redesign',
  planPath: null,
  ...overrides
});

describe('DetailTreeProvider', () => {
  let provider: DetailTreeProvider;
  let service: jest.Mocked<WorkspaceService>;
  let view: any;
  const vscode = require('vscode');

  beforeEach(() => {
    jest.clearAllMocks();

    service = {
      find: jest.fn().mockResolvedValue(workspace()),
      agentStates: jest.fn().mockResolvedValue([]),
      notesFor: jest.fn().mockResolvedValue([
        { name: 'plan.md', isDirectory: false },
        { name: 'transcripts', isDirectory: true }
      ]),
      listDirectory: jest.fn().mockResolvedValue([{ name: 'run-1.txt', isDirectory: false }])
    } as any;

    view = { title: '', description: undefined, message: undefined };

    provider = new DetailTreeProvider(service);
    provider.attach(view);
  });

  const context = (key: string) =>
    vscode.commands.executeCommand.mock.calls
      .filter(([command, name]: string[]) => command === 'setContext' && name === key)
      .pop()?.[2];

  it('says nothing is selected before a ticket arrives', () => {
    expect(view.title).toBe('Task');
    expect(view.message).toBe('No task selected. Pick one from Tasks.');
  });

  it('titles itself with the ticket and its status', async () => {
    await provider.setTicket('SABIN-0022');

    expect(view.title).toBe('SABIN-0022');
    expect(view.description).toBe('In progress');
    expect(view.message).toBeUndefined();
  });

  it('lists the scratchpad, the task file and the notes, in that order', async () => {
    await provider.setTicket('SABIN-0022');
    const rows = await provider.getChildren();

    expect(rows.map(row => [row.label, row.contextValue])).toEqual([
      ['SABIN-0022-redesign.md', 'sabinPrompt'],
      ['SABIN-0022.md', 'sabinTaskFile'],
      ['plan.md', 'sabinNote'],
      ['transcripts', 'sabinNotesDir']
    ]);
  });

  // The two derived paths must not share a context value with real notes, or
  // the rename and delete menu items would appear on files that cannot move
  it('never marks the scratchpad or the task file as a note', async () => {
    await provider.setTicket('SABIN-0022');
    const rows = await provider.getChildren();

    const derived = rows.filter(row => row.kind === 'prompt' || row.kind === 'taskFile');
    expect(derived).toHaveLength(2);
    expect(derived.every(row => row.contextValue !== 'sabinNote')).toBe(true);
  });

  it('expands a notes directory from disk', async () => {
    await provider.setTicket('SABIN-0022');
    const rows = await provider.getChildren();
    const dir = rows.find(row => row.kind === 'notesDir') as DetailNode;

    expect((await provider.getChildren(dir)).map(row => row.label)).toEqual(['run-1.txt']);
  });

  it('shows the agents a ticket has, most urgent first', async () => {
    service.agentStates.mockResolvedValue([
      { sessionId: 'a', ticket: 'SABIN-0022', agent: 'claude', activity: 'idle' },
      { sessionId: 'b', ticket: 'SABIN-0022', agent: 'codex', activity: 'waiting' },
      { sessionId: 'c', ticket: 'SABIN-0019', agent: 'claude', activity: 'busy' }
    ] as any);

    await provider.setTicket('SABIN-0022');
    const sessions = (await provider.getChildren()).filter(row => row.kind === 'session');

    expect(sessions.map(row => row.label)).toEqual(['codex', 'claude']);
    expect(context('sabin.detailHasAgent')).toBe(true);
  });

  it('gates the title-bar buttons on what the ticket actually has', async () => {
    await provider.setTicket('SABIN-0022');
    expect(context('sabin.detailHasWorktree')).toBe(true);
    expect(context('sabin.detailHasAgent')).toBe(false);

    service.find.mockResolvedValue(workspace({ branch: null }));
    await provider.refresh();
    expect(context('sabin.detailHasWorktree')).toBe(false);
  });

  it('says so when the ticket is not in this Sabin directory', async () => {
    service.find.mockResolvedValue(undefined);
    await provider.setTicket('NOPE-1');

    expect(view.message).toBe('NOPE-1 is not in this Sabin directory.');
    expect(await provider.getChildren()).toEqual([]);
  });

  it('surfaces a read failure rather than rendering an empty task', async () => {
    service.find.mockRejectedValue(new Error('no .sabin here'));
    await provider.setTicket('SABIN-0022');

    expect(view.message).toContain('no .sabin here');
    expect(await provider.getChildren()).toEqual([]);
  });

  it('shows an empty-notes row rather than nothing at all', async () => {
    service.notesFor.mockResolvedValue([]);
    await provider.setTicket('SABIN-0022');

    const rows = await provider.getChildren();
    expect(rows[rows.length - 1].label).toBe('No notes yet');
  });
});
