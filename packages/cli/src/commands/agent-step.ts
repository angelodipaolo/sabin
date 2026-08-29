import { spawn } from 'child_process';
import chalk from 'chalk';
import {
  resolveAgent,
  agentArgv,
  buildTaskPrompt,
  pathExists,
  UnknownAgentError,
  AgentDefinition,
  ResolvedAgent,
  SabinConfig,
  TaskStatus,
  Workspace,
  WorkflowStep
} from '@sabin/core';
import { getWorkspace, fail } from '../workspace-context';
import { ensureWorkspace } from '../workspace-start';
import { isITerm, labelTab, openTab, shellQuote } from '../iterm';

export interface StepOptions {
  agent?: string;
  claude?: boolean;
  codex?: boolean;
  print?: boolean;
  start?: boolean;
  launch?: boolean;
  tab?: boolean;
  here?: boolean;
  yolo?: boolean;
  supervised?: boolean;
  /** Skip worktree and branch creation. Tests only - no flag sets it. */
  noWorktree?: boolean;
}

/**
 * The status a step leaves the task in.
 *
 * Only implementing means "work underway". Planning happens before a task is
 * even `ready`, and reviewing happens when it is already in `review` - moving
 * either of those to `in_progress` would walk the task backwards.
 *
 * `implement` cannot walk one backwards either: `stepStatus` in
 * workspace-start.ts only ever moves a task forward, so re-running it on a
 * ticket in `review` - which is what addressing feedback looks like - leaves it
 * there.
 */
const STATUS_FOR_STEP: Record<WorkflowStep, TaskStatus | null> = {
  plan: null,
  implement: 'in_progress',
  review: null
};

/**
 * Put an agent on a ticket for one step of the workflow.
 *
 * The three verbs - `plan`, `implement`, `review` - are this function with a
 * different step, so they cannot drift apart: same flags, same workspace
 * handling, same launch. Only the prompt differs, and the prompt is three
 * lines naming the step.
 *
 * The agent runs with its cwd set to the ticket's worktree, which is what
 * makes this a one-command kickoff: no `cd`, no shell wrapper - the child is
 * born in the right directory. Under iTerm2 it lands in a new tab so the
 * shell you typed it in stays yours.
 */
export async function runStep(
  step: WorkflowStep,
  ticketArg: string | undefined,
  options: StepOptions
): Promise<void> {
  const { workspace, config } = await getWorkspace(ticketArg);

  // A task is what there is to work from. `sabin task create` makes them;
  // these verbs never invent one.
  if (!workspace.taskFile) {
    fail(
      `No task found for ${workspace.ticket}.\n` +
      `Create it first:  sabin task create "<title>" -n ${workspace.ticket}`
    );
  }

  const agent = chooseAgent(options, config);
  const prompt = buildTaskPrompt({ step, ticket: workspace.ticket, taskFile: workspace.taskFile });

  // --print is a pure read: no worktree, no status change, so it stays safe
  // to pipe into something else
  if (options.print) {
    console.log(prompt);
    return;
  }

  const started = options.start === false
    ? null
    : await ensureWorkspace(ticketArg ?? workspace.ticket, {
        status: STATUS_FOR_STEP[step],
        noWorktree: options.noWorktree
      });

  const cwd = started?.worktreeDir ?? (await workingDirectory(workspace.worktreeDir, workspace.mainRoot));

  // --no-launch is "just build the workspace" - what `sabin start` used to be
  if (options.launch === false) {
    if (started) reportWorkspace(started.workspace, started.branch, started.worktreeDir, started.created);
    return;
  }

  const autonomous = wantsAutonomy(options, config);

  if (inNewTab(options)) {
    await launchInTab(step, workspace, cwd, agent, autonomous);
    return;
  }

  const argv = agentArgv(
    agent.definition,
    {
      prompt,
      ticket: workspace.ticket,
      notesDir: workspace.notesDir,
      worktree: cwd,
      taskFile: workspace.taskFile
    },
    autonomous
  );

  labelTab(workspace.name);
  console.error(chalk.gray(`▸ ${agent.name} ${step} ${workspace.ticket}${autonomous ? ' (autonomous)' : ''}`));

  await launch(agent.definition, argv, cwd);
}

/**
 * A new tab is the default where there is one to open, so the shell you typed
 * the command in comes straight back to you. `--here` takes it over instead,
 * and outside iTerm2 there is nothing to open, so it is implied.
 */
function inNewTab(options: StepOptions): boolean {
  if (options.here) return false;
  if (options.tab) return true;
  return isITerm();
}

/**
 * Re-run ourselves in the new tab.
 *
 * The workspace is already built, so the child only has to launch - but it
 * has to be told everything the parent decided, or it opens a tab of its own
 * and launches a different agent under different permissions.
 */
async function launchInTab(
  step: WorkflowStep,
  workspace: Workspace,
  cwd: string,
  agent: ResolvedAgent,
  autonomous: boolean
): Promise<void> {
  if (!isITerm()) fail('--tab needs iTerm2 (TERM_PROGRAM is not iTerm.app).');

  const argv = [
    'sabin', step, workspace.ticket,
    '--no-start', '--here',
    '--agent', agent.name,
    autonomous ? '--yolo' : '--supervised'
  ].map(shellQuote);

  await openTab(cwd, argv.join(' '));
  console.error(chalk.gray(
    `▸ ${agent.name} ${step} ${workspace.ticket} in a new tab${autonomous ? ' (autonomous)' : ''}`
  ));
}

/**
 * Autonomy is off unless asked for: an agent that edits without stopping is
 * a choice, not something to inherit by installing Sabin.
 */
function wantsAutonomy(options: StepOptions, config: SabinConfig): boolean {
  if (options.supervised) return false;
  if (options.yolo) return true;
  return config.agents?.autonomous === true;
}

function chooseAgent(options: StepOptions, config: SabinConfig): ResolvedAgent {
  const name = options.agent ?? (options.codex ? 'codex' : options.claude ? 'claude' : undefined);

  try {
    return resolveAgent(name, config);
  } catch (error) {
    if (error instanceof UnknownAgentError) fail(error.message);
    throw error;
  }
}

/** What `sabin start` printed, for `--no-agent` */
function reportWorkspace(
  workspace: Workspace,
  branch: string,
  worktreeDir: string | null,
  created: string[]
): void {
  const mark = (target: string) => created.includes(target) ? chalk.green('created') : chalk.gray('exists ');

  console.log(`\n${chalk.bold(workspace.name)}`);
  console.log(`  ${chalk.gray('Branch:')}   ${branch}`);
  if (worktreeDir) console.log(`  ${mark(worktreeDir)} ${worktreeDir}`);
  console.log(`  ${mark(workspace.notesDir)} ${chalk.cyan(workspace.notesDir)}`);
  console.log(`  ${mark(workspace.promptFile)} ${workspace.promptFile}`);
  console.log();
}

/**
 * Where to run when --no-start left us without a freshly made worktree: the
 * ticket's worktree if it happens to exist, otherwise the repo itself.
 */
async function workingDirectory(worktreeDir: string, mainRoot: string | null): Promise<string> {
  return (await pathExists(worktreeDir)) ? worktreeDir : mainRoot ?? process.cwd();
}

function launch(definition: AgentDefinition, argv: string[], cwd: string): Promise<void> {
  return new Promise(resolve => {
    const child = spawn(definition.command, argv, {
      cwd,
      stdio: 'inherit',
      env: { ...process.env, ...(definition.env ?? {}) }
    });

    // The agent owns the terminal, so it owns Ctrl-C too. Without this the
    // parent dies first and the agent is left writing to a dead shell.
    const ignore = () => {};
    process.on('SIGINT', ignore);

    child.on('error', (error: NodeJS.ErrnoException) => {
      process.off('SIGINT', ignore);
      if (error.code === 'ENOENT') {
        fail(
          `Could not run "${definition.command}".\n` +
          `Install it, or point Sabin at the right executable under ` +
          `"agents.definitions" in config.json.`
        );
      }
      fail(`Failed to launch agent: ${error.message}`);
    });

    child.on('exit', (code, signal) => {
      process.off('SIGINT', ignore);
      resolve();
      // Carry the agent's outcome, so `sabin implement ... && ...` behaves
      process.exit(signal ? 1 : code ?? 0);
    });
  });
}
