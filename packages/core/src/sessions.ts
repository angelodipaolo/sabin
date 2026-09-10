import path from 'path';
import { SabinConfig } from './types';
import { WorkflowStep, isWorkflowStep, availableAgents } from './agents';
import { WorktreeInfo } from './git';
import { ticketFromBranch } from './workspace';
import { TerminalSession } from './terminal/types';
import { ForegroundJob } from './terminal/processes';
import { AgentState, AgentActivity } from './agentState';

export type SessionRole = 'agent' | 'shell';

export interface TicketSession extends TerminalSession {
  ticket: string;
  worktree: string;
  role: SessionRole;
  /** Which agent, when the role is `agent`: "claude", "codex", a configured name */
  agent: string | null;
  /** The workflow step a Sabin-launched agent was given, when it can be read */
  step: WorkflowStep | null;
  /** The process this session is really about - see `chooseJob` */
  job: ForegroundJob | null;
  cwd: string | null;
  /**
   * What the agent is doing, when hooks have reported it.
   *
   * Absent is not a state: an agent with no hooks installed, or one that has
   * not taken a turn yet, has nothing to say and gets no badge rather than a
   * guessed one.
   */
  activity: AgentActivity | null;
  /** When `activity` last changed */
  activitySince: string | null;
}

/**
 * Which ticket each live terminal belongs to.
 *
 * Derived from the working directory, every time, the same way `findPlan()`
 * derives a plan from the notes directory. A session belongs to SABIN-0017
 * because it is *inside* SABIN-0017's worktree - which means a tab you opened
 * by hand and cd'd into counts exactly as much as one Sabin launched, and
 * there is no registry to fall out of date the first time you close a tab.
 *
 * Sessions outside every ticket worktree - the main clone, your home
 * directory, another project - are dropped rather than guessed at.
 */
export function groupSessionsByTicket(
  sessions: TerminalSession[],
  worktrees: WorktreeInfo[],
  config: SabinConfig,
  states?: Map<string, AgentState>
): Map<string, TicketSession[]> {
  const ticketed = ticketWorktrees(worktrees, config);
  const grouped = new Map<string, TicketSession[]>();

  for (const session of sessions) {
    const job = chooseJob(session.jobs, config);

    // The chosen job's own worktree wins. Falling back to "the first member
    // that matches" reads the group leader first, and with `--here` the
    // leader is a `sabin` launcher in whatever ticket you typed the command
    // in, while the agent it started is in the target ticket - which would
    // file the terminal under the ticket you left rather than the one you are
    // now in.
    //
    // Other members are still consulted, because the chosen job is not always
    // the one with a readable cwd: `sabin implement` run from the main clone
    // is the leader, and the agent in the worktree is its child.
    const match =
      matchWorktree(job?.cwd ?? null, ticketed) ??
      session.jobs.map(candidate => matchWorktree(candidate.cwd, ticketed)).find(Boolean);
    if (!match) continue;

    const state = states?.get(session.id);
    const found = grouped.get(match.ticket) ?? [];
    found.push({
      ...session,
      ticket: match.ticket,
      worktree: match.root,
      job,
      cwd: job?.cwd ?? null,
      activity: state?.activity ?? null,
      activitySince: state?.since ?? null,
      ...classify(job, config)
    });
    grouped.set(match.ticket, found);
  }

  // What needs you, then what is working, then everything else - the order
  // the picker shows, so ⌥Space Enter goes to whatever is waiting
  for (const list of grouped.values()) {
    list.sort((a, b) => {
      if (a.role !== b.role) return a.role === 'agent' ? -1 : 1;
      const urgency = ACTIVITY_ORDER[a.activity ?? 'none'] - ACTIVITY_ORDER[b.activity ?? 'none'];
      if (urgency !== 0) return urgency;
      return a.tabIndex - b.tabIndex;
    });
  }

  return grouped;
}

const ACTIVITY_ORDER: Record<string, number> = { waiting: 0, busy: 1, idle: 2, none: 3 };

/**
 * Which process in the foreground group the session is really about.
 *
 * Neither "the group leader" nor "the deepest child" is right on its own:
 *
 * - `sabin implement` stays alive as the leader with the agent as its child,
 *   so the leader is a launcher and the child is the answer.
 * - Claude Code is the leader and spawns mcpbridge, so the leader is the
 *   answer and the child is noise.
 *
 * What both have in common is that the interesting process is the agent. So
 * prefer a member that matches a configured agent, and fall back to the
 * leader when none does - which is every ordinary shell.
 */
export function chooseJob(jobs: ForegroundJob[], config: SabinConfig): ForegroundJob | null {
  if (jobs.length === 0) return null;
  return jobs.find(job => agentName(job.program, config)) ?? jobs[0];
}

interface TicketWorktree {
  ticket: string;
  root: string;
}

/** Worktrees whose branch names a ticket, longest path first */
function ticketWorktrees(worktrees: WorktreeInfo[], config: SabinConfig): TicketWorktree[] {
  const ticketed: TicketWorktree[] = [];

  for (const worktree of worktrees) {
    if (!worktree.branch) continue;
    const ticket = ticketFromBranch(worktree.branch, config);
    if (!ticket) continue;
    ticketed.push({ ticket, root: path.resolve(worktree.path) });
  }

  // Worktree roots can nest - a repo checked out inside another repo's
  // worktree - so the deepest match has to win
  return ticketed.sort((a, b) => b.root.length - a.root.length);
}

function matchWorktree(cwd: string | null, worktrees: TicketWorktree[]): TicketWorktree | null {
  if (!cwd) return null;
  const resolved = path.resolve(cwd);

  return worktrees.find(
    worktree => resolved === worktree.root || resolved.startsWith(worktree.root + path.sep)
  ) ?? null;
}

function classify(
  job: ForegroundJob | null,
  config: SabinConfig
): { role: SessionRole; agent: string | null; step: WorkflowStep | null } {
  const agent = agentName(job?.program ?? null, config);
  if (!agent) return { role: 'shell', agent: null, step: null };

  return { role: 'agent', agent, step: stepFromCommand(job?.command ?? null) };
}

/**
 * Matched against the command line from `ps`, never against iTerm2's
 * `jobName`: Claude Code rewrites its process title to its version number, so
 * jobName reads "2.1.246" and the most important case is the one that fails.
 */
function agentName(program: string | null, config: SabinConfig): string | null {
  if (!program) return null;

  const agents = availableAgents(config);
  for (const [name, definition] of Object.entries(agents)) {
    if (program === name) return name;
    if (path.basename(definition.command) === program) return name;
  }

  return null;
}

/**
 * The step a launched agent was given, read back out of its own command line.
 *
 * `buildTaskPrompt()` passes the prompt as an argument, so "Follow the sabin
 * skill: implement SABIN-0017" is still visible in `ps` for as long as the
 * agent runs. Free, and more precise than the working directory - but only a
 * supplement, because an agent you started by hand has none of it.
 */
export function stepFromCommand(command: string | null): WorkflowStep | null {
  if (!command) return null;

  const match = command.match(/Follow the sabin skill:\s+(\w+)/);
  if (!match) return null;

  return isWorkflowStep(match[1]) ? match[1] : null;
}

/**
 * The window that is already this ticket's alone, if it has one.
 *
 * Derived like everything else here, and **exclusive on purpose**. Picking
 * the window that merely holds most of a ticket's sessions is not enough: on
 * a machine that already has one big window with every ticket in it, every
 * ticket's "own" window is that window, so every new tab joins it and the
 * flat tab bar this ticket exists to replace survives for ever.
 *
 * Requiring the window to hold no *other* ticket means a shared window is
 * never reused, so the next tab for a ticket starts a window of its own and
 * the layout migrates one ticket at a time instead of needing a clean slate.
 *
 * Sessions attributed to no ticket - a shell in the main clone - do not count
 * against exclusivity. They are not part of another ticket's workspace and
 * excluding them would mean never reusing anything.
 */
export function windowForTicket(
  ticket: string,
  grouped: Map<string, TicketSession[]>
): string | null {
  const mine = grouped.get(ticket) ?? [];
  if (mine.length === 0) return null;

  const taken = new Set<string>();
  for (const [other, sessions] of grouped) {
    if (other === ticket) continue;
    for (const session of sessions) taken.add(session.windowId);
  }

  const counts = new Map<string, number>();
  for (const session of mine) {
    if (taken.has(session.windowId)) continue;
    counts.set(session.windowId, (counts.get(session.windowId) ?? 0) + 1);
  }

  let best: string | null = null;
  let most = 0;
  for (const [windowId, count] of counts) {
    if (count > most) {
      best = windowId;
      most = count;
    }
  }

  return best;
}

/**
 * What a tab is called: `SABIN-0017 · claude`.
 *
 * The ticket first, because that is what you scan for, and the role after it,
 * because a ticket with three tabs needs them told apart. Also what makes
 * iTerm2's own Open Quickly (⇧⌘O) able to find these tabs, at no cost to us.
 */
export function sessionTitle(ticket: string, role: string): string {
  return `${ticket} · ${role}`;
}
