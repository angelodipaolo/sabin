import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  ticketFromBranch,
  slugify,
  branchNameFor,
  workspacePaths,
  defaultWorktreeRoot,
  parseTicketArg,
  workspaceName,
  slugFromBranch,
  findWorkspaceDir,
  slugFromTitle,
  resolveWorkspace,
  UnknownTicketError,
  NoTicketError,
  findFeedback,
  feedbackPath
} from '../workspace';
import { findTaskFile } from '../tasks';
import { SabinConfig } from '../types';

const config: SabinConfig = {
  projectPrefix: 'SABIN',
  taskNumberPadding: 4,
  branch: { prefix: 'angelo' }
};

describe('ticketFromBranch', () => {
  it('extracts the project ticket from a prefixed branch', () => {
    expect(ticketFromBranch('angelo/SABIN-0004-parallel-worktrees', config)).toBe('SABIN-0004');
  });

  it('extracts a bare ticket branch', () => {
    expect(ticketFromBranch('SABIN-0004', config)).toBe('SABIN-0004');
  });

  it('extracts external JIRA-style keys', () => {
    expect(ticketFromBranch('angelo/JIRA-12345-fix-login', config)).toBe('JIRA-12345');
    expect(ticketFromBranch('angelo/NTVARCH-23252-thing', config)).toBe('NTVARCH-23252');
  });

  it('normalises the project prefix to uppercase', () => {
    expect(ticketFromBranch('angelo/sabin-0004-thing', config)).toBe('SABIN-0004');
  });

  it('does not mistake lowercase slug fragments for tickets', () => {
    expect(ticketFromBranch('angelo/add-2fa-support', config)).toBeNull();
    expect(ticketFromBranch('feature/upgrade-to-node-20', config)).toBeNull();
  });

  it('returns null for branches with no ticket', () => {
    expect(ticketFromBranch('main', config)).toBeNull();
    expect(ticketFromBranch('', config)).toBeNull();
  });

  it('prefers the project prefix over an unrelated key', () => {
    expect(ticketFromBranch('angelo/SABIN-0004-port-of-JIRA-99', config)).toBe('SABIN-0004');
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Task workspaces - worktree, notes')).toBe('task-workspaces-worktree-notes');
  });

  it('trims to a sane length without a trailing hyphen', () => {
    const slug = slugify('a'.repeat(80));
    expect(slug.length).toBeLessThanOrEqual(50);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('truncates on a word boundary, never mid-word', () => {
    // alpha-beta-gamma is exactly 16; delta would overshoot, so it is dropped whole
    expect(slugify('alpha beta gamma delta', 16)).toBe('alpha-beta-gamma');
    expect(slugify('alpha beta gamma delta', 15)).toBe('alpha-beta');
  });

  it('still yields something when a single word exceeds the cap', () => {
    expect(slugify('supercalifragilistic', 10)).toBe('supercalif');
  });
});

describe('slugFromTitle', () => {
  it('derives a short suffix from a title', () => {
    expect(slugFromTitle('Update telemetry pipeline', config)).toBe('update-telemetry-pipeline');
  });

  it('drops filler words so real words fit', () => {
    expect(slugFromTitle('Support for multiple plans per task', config))
      .toBe('support-multiple-plans-task');
  });

  it('caps long titles on a word boundary', () => {
    const slug = slugFromTitle(
      'Task workspaces - worktree, notes, and prompt file per ticket', config
    );

    expect(slug!.length).toBeLessThanOrEqual(32);
    expect(slug).toBe('task-workspaces-worktree-notes');
  });

  it('honours a custom maxLength', () => {
    const short: SabinConfig = { ...config, slug: { maxLength: 12 } };
    expect(slugFromTitle('Update telemetry pipeline', short)).toBe('update');
  });

  it('keeps filler words when stopWords is off', () => {
    const literal: SabinConfig = { ...config, slug: { stopWords: false, maxLength: 40 } };
    expect(slugFromTitle('Support for multiple plans', literal))
      .toBe('support-for-multiple-plans');
  });

  it('never ends on a filler word, even with stopWords off', () => {
    const literal: SabinConfig = { ...config, slug: { stopWords: false, maxLength: 30 } };
    expect(slugFromTitle('Support for multiple plans per task', literal))
      .toBe('support-for-multiple-plans');
  });

  it('returns null when derivation is switched off', () => {
    const off: SabinConfig = { ...config, slug: { from: 'none' } };
    expect(slugFromTitle('Update telemetry', off)).toBeNull();
  });

  it('returns null for an empty title', () => {
    expect(slugFromTitle('', config)).toBeNull();
    expect(slugFromTitle('- , -', config)).toBeNull();
  });

  it('falls back to filler words when stripping leaves nothing', () => {
    expect(slugFromTitle('For the win', config)).toBe('win');
  });
});

describe('parseTicketArg', () => {
  it('splits a ticket from its descriptive suffix', () => {
    expect(parseTicketArg('JIRA-12345-update-telemetry'))
      .toEqual({ ticket: 'JIRA-12345', slug: 'update-telemetry' });
  });

  it('handles a bare ticket', () => {
    expect(parseTicketArg('SABIN-0004')).toEqual({ ticket: 'SABIN-0004', slug: null });
  });

  it('uppercases the ticket and slugifies the suffix', () => {
    expect(parseTicketArg('sabin-0004-Some Thing'))
      .toEqual({ ticket: 'SABIN-0004', slug: 'some-thing' });
  });

  it('keeps numeric fragments in the suffix', () => {
    expect(parseTicketArg('JIRA-12345-add-2fa'))
      .toEqual({ ticket: 'JIRA-12345', slug: 'add-2fa' });
  });

  it('rejects things that are not tickets', () => {
    expect(parseTicketArg('just-a-branch')).toBeNull();
    expect(parseTicketArg('')).toBeNull();
  });
});

describe('workspaceName', () => {
  it('appends the suffix when present', () => {
    expect(workspaceName('JIRA-12345', 'update-telemetry')).toBe('JIRA-12345-update-telemetry');
  });

  it('is the bare ticket without one', () => {
    expect(workspaceName('SABIN-0004', null)).toBe('SABIN-0004');
  });
});

describe('slugFromBranch', () => {
  it('recovers the suffix from a prefixed branch', () => {
    expect(slugFromBranch('angelo/JIRA-12345-update-telemetry', 'JIRA-12345'))
      .toBe('update-telemetry');
  });

  it('returns null when the branch is just the ticket', () => {
    expect(slugFromBranch('angelo/SABIN-0004', 'SABIN-0004')).toBeNull();
  });
});

describe('branchNameFor', () => {
  it('applies the default template', () => {
    expect(branchNameFor('SABIN-0004', 'Parallel worktrees', config))
      .toBe('angelo/SABIN-0004-parallel-worktrees');
  });

  it('uses a descriptive suffix verbatim', () => {
    expect(branchNameFor('JIRA-12345', 'update-telemetry', config))
      .toBe('angelo/JIRA-12345-update-telemetry');
  });

  it('omits an empty prefix cleanly', () => {
    const bare: SabinConfig = { projectPrefix: 'SABIN', taskNumberPadding: 4 };
    expect(branchNameFor('SABIN-0004', 'Parallel worktrees', bare))
      .toBe('SABIN-0004-parallel-worktrees');
  });

  it('honours a custom template', () => {
    const custom: SabinConfig = { ...config, branch: { prefix: 'ad', template: '{prefix}/{ticket}' } };
    expect(branchNameFor('SABIN-0004', 'Anything', custom)).toBe('ad/SABIN-0004');
  });
});

describe('workspacePaths', () => {
  const sabinDir = '/notes/myproject/.sabin';
  const mainRoot = '/dev/myproject';

  it('derives every path from the ticket ID', () => {
    const paths = workspacePaths({ ticket: 'SABIN-0004', slug: null }, sabinDir, mainRoot, config);

    expect(paths.notesDir).toBe('/notes/myproject/.sabin/notes/SABIN-0004');
    expect(paths.promptFile).toBe('/notes/myproject/.sabin/prompts/SABIN-0004.md');
    expect(paths.worktreeDir).toBe('/dev/myproject-worktrees/SABIN-0004');
  });

  it('includes the descriptive suffix in every directory name', () => {
    const paths = workspacePaths(
      { ticket: 'JIRA-12345', slug: 'update-telemetry' }, sabinDir, mainRoot, config
    );

    expect(paths.name).toBe('JIRA-12345-update-telemetry');
    expect(paths.notesDir).toBe('/notes/myproject/.sabin/notes/JIRA-12345-update-telemetry');
    expect(paths.promptFile).toBe('/notes/myproject/.sabin/prompts/JIRA-12345-update-telemetry.md');
    expect(paths.worktreeDir).toBe('/dev/myproject-worktrees/JIRA-12345-update-telemetry');
  });

  it('honours configured notes and prompts directories', () => {
    const custom: SabinConfig = { ...config, notesDir: 'docs', promptsDir: 'scratch' };
    const paths = workspacePaths({ ticket: 'SABIN-0004', slug: null }, sabinDir, mainRoot, custom);

    expect(paths.notesDir).toBe('/notes/myproject/.sabin/docs/SABIN-0004');
    expect(paths.promptFile).toBe('/notes/myproject/.sabin/scratch/SABIN-0004.md');
  });

  it('resolves a configured worktree root against the main clone', () => {
    const custom: SabinConfig = { ...config, worktrees: { root: '../trees' } };
    expect(workspacePaths({ ticket: 'SABIN-0004', slug: null }, sabinDir, mainRoot, custom).worktreeDir)
      .toBe('/dev/trees/SABIN-0004');
  });

  it('falls back when there is no main clone', () => {
    expect(workspacePaths({ ticket: 'SABIN-0004', slug: null }, sabinDir, null, config).worktreeDir)
      .toBe('/notes/myproject/.sabin/worktrees/SABIN-0004');
  });
});

describe('defaultWorktreeRoot', () => {
  it('is a sibling of the main clone', () => {
    expect(defaultWorktreeRoot('/dev/myproject')).toBe('/dev/myproject-worktrees');
  });
});

describe('findTaskFile', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-ws-'));
    await fs.mkdir(path.join(testDir, 'tasks', 'open'), { recursive: true });
    await fs.mkdir(path.join(testDir, 'tasks', 'completed'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('finds a task in open/', async () => {
    const target = path.join(testDir, 'tasks', 'open', 'SABIN-0004.md');
    await fs.writeFile(target, '---\nstatus: open\n---\n');

    expect(await findTaskFile(testDir, 'SABIN-0004')).toBe(target);
  });

  it('finds a task in any status directory', async () => {
    const target = path.join(testDir, 'tasks', 'completed', 'SABIN-0001.md');
    await fs.writeFile(target, '---\nstatus: completed\n---\n');

    expect(await findTaskFile(testDir, 'SABIN-0001')).toBe(target);
  });

  it('returns null when the task does not exist', async () => {
    expect(await findTaskFile(testDir, 'SABIN-9999')).toBeNull();
  });
});

describe('findWorkspaceDir', () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-dir-'));
  });

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('finds a suffixed directory from the bare ticket', async () => {
    await fs.mkdir(path.join(testDir, 'JIRA-12345-update-telemetry'));

    expect(await findWorkspaceDir(testDir, 'JIRA-12345')).toBe('JIRA-12345-update-telemetry');
  });

  it('prefers an exact match', async () => {
    await fs.mkdir(path.join(testDir, 'SABIN-0004'));
    await fs.mkdir(path.join(testDir, 'SABIN-0004-something'));

    expect(await findWorkspaceDir(testDir, 'SABIN-0004')).toBe('SABIN-0004');
  });

  it('refuses to guess between two suffixed candidates', async () => {
    await fs.mkdir(path.join(testDir, 'SABIN-0004-one'));
    await fs.mkdir(path.join(testDir, 'SABIN-0004-two'));

    expect(await findWorkspaceDir(testDir, 'SABIN-0004')).toBeNull();
  });

  it('returns null for a missing root', async () => {
    expect(await findWorkspaceDir(path.join(testDir, 'nope'), 'SABIN-0004')).toBeNull();
  });
});

describe('resolveWorkspace', () => {
  let root: string;
  let sabinDir: string;

  async function writeTask(id: string, title: string): Promise<void> {
    const dir = path.join(sabinDir, 'tasks', 'open');
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${id}.md`), `---\nstatus: open\ntitle: ${title}\n---\n`);
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-resolve-'));
    sabinDir = path.join(root, '.sabin');
    await fs.mkdir(sabinDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    delete process.env.SABIN_TICKET;
  });

  it('resolves a named ticket that has a task', async () => {
    await writeTask('SABIN-0001', 'Update telemetry');

    const workspace = await resolveWorkspace({ sabinDir, config, cwd: root, ticket: 'SABIN-0001' });

    expect(workspace.ticket).toBe('SABIN-0001');
    expect(workspace.notesDir).toBe(path.join(sabinDir, 'notes', 'SABIN-0001-update-telemetry'));
  });

  it('uses the task title instead of a stale notes-directory suffix', async () => {
    await writeTask('TASK-1234', 'Update tracking contract');
    await fs.mkdir(path.join(sabinDir, 'notes', 'TASK-1234-task-1234'), { recursive: true });

    const workspace = await resolveWorkspace({ sabinDir, config, cwd: root, ticket: 'TASK-1234' });

    expect(workspace.slug).toBe('update-tracking-contract');
    expect(workspace.notesDir).toBe(path.join(sabinDir, 'notes', 'TASK-1234-update-tracking-contract'));
  });

  // A typo would otherwise resolve cleanly and send notes somewhere nothing
  // else will ever look
  it('refuses a named ticket with no task', async () => {
    await expect(
      resolveWorkspace({ sabinDir, config, cwd: root, ticket: 'NOPE-1' })
    ).rejects.toThrow(UnknownTicketError);

    await expect(
      resolveWorkspace({ sabinDir, config, cwd: root, ticket: 'NOPE-1' })
    ).rejects.toThrow('sabin task create "<title>" -n NOPE-1');
  });

  it('refuses a ticket named through SABIN_TICKET with no task', async () => {
    process.env.SABIN_TICKET = 'NOPE-1';

    await expect(
      resolveWorkspace({ sabinDir, config, cwd: root })
    ).rejects.toThrow(UnknownTicketError);
  });

  it('resolves a missing task for the callers that are about to create one', async () => {
    const workspace = await resolveWorkspace({
      sabinDir, config, cwd: root, ticket: 'SABIN-0002', allowMissingTask: true
    });

    expect(workspace.ticket).toBe('SABIN-0002');
    expect(workspace.taskFile).toBeNull();
  });

  // `sabin task create` records the branch before the task file lands, so a
  // ticket read off the branch must keep resolving without one
  it('allows a branch-inferred ticket with no task', async () => {
    const repo = path.join(root, 'repo');
    await fs.mkdir(repo, { recursive: true });
    await promisify(execFile)('git', ['init', '-q', '-b', 'me/SABIN-0003-weigh-options'], { cwd: repo });

    const workspace = await resolveWorkspace({ sabinDir, config, cwd: repo });

    expect(workspace.ticket).toBe('SABIN-0003');
    expect(workspace.taskFile).toBeNull();
  });

  it('still needs a ticket from somewhere', async () => {
    await expect(resolveWorkspace({ sabinDir, config, cwd: root })).rejects.toThrow(NoTicketError);
  });
});

describe('findFeedback', () => {
  let notesDir: string;

  beforeEach(async () => {
    notesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-feedback-'));
  });

  afterEach(async () => {
    await fs.rm(notesDir, { recursive: true, force: true });
  });

  it('returns the path once the file exists', async () => {
    await fs.writeFile(feedbackPath(notesDir), '# Feedback: SABIN-0020\n');

    expect(await findFeedback(notesDir)).toBe(path.join(notesDir, 'feedback.md'));
  });

  it('returns null before anything has been reviewed', async () => {
    expect(await findFeedback(notesDir)).toBeNull();
  });
});
