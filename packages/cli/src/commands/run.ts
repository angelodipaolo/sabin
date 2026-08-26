import fs from 'fs/promises';
import { spawn } from 'child_process';
import chalk from 'chalk';
import {
  parseTask,
  resolveAgent,
  agentArgv,
  buildTaskPrompt,
  UnknownAgentError,
  AgentDefinition,
  ResolvedAgent,
  SabinConfig
} from '@sabin/core';
import { getWorkspace, fail } from '../workspace-context';
import { ensureWorkspace } from '../workspace-start';

interface RunOptions {
  agent?: string;
  claude?: boolean;
  codex?: boolean;
  print?: boolean;
  start?: boolean;
}

/**
 * Launch a coding agent on a task, prompted with the task itself.
 *
 * The agent runs in the foreground with its cwd set to the ticket's worktree,
 * which is what makes this a one-command kickoff: no `cd`, no shell wrapper -
 * the child is simply born in the right directory, and when it exits you are
 * back where you started.
 */
export async function runAgent(ticketArg: string | undefined, options: RunOptions): Promise<void> {
  const { workspace, config } = await getWorkspace(ticketArg);

  // An invented task is nothing to prompt an agent with, so unlike `start`
  // this refuses to create one
  if (!workspace.taskFile) {
    fail(
      `No task found for ${workspace.ticket}.\n` +
      `Create it first:  sabin task create -n ${workspace.ticket} -t "<title>"`
    );
  }

  const agent = chooseAgent(options, config);

  const task = await parseTask(workspace.taskFile);
  const prompt = buildTaskPrompt({
    ticket: workspace.ticket,
    title: task.title,
    notesDir: workspace.notesDir,
    body: task.content
  });

  // --print is a pure read: no worktree, no status change, so it stays safe
  // to pipe into something else
  if (options.print) {
    console.log(prompt);
    return;
  }

  const started = options.start === false
    ? null
    : await ensureWorkspace(ticketArg ?? workspace.ticket);

  const cwd = started?.worktreeDir ?? (await workingDirectory(workspace.worktreeDir, workspace.mainRoot));
  const argv = agentArgv(agent.definition, {
    prompt,
    ticket: workspace.ticket,
    notesDir: workspace.notesDir,
    worktree: cwd,
    taskFile: workspace.taskFile
  });

  console.error(chalk.gray(`▸ ${agent.name} in ${cwd}`));

  await launch(agent.definition, argv, cwd);
}

function chooseAgent(options: RunOptions, config: SabinConfig): ResolvedAgent {
  const name = options.agent ?? (options.codex ? 'codex' : options.claude ? 'claude' : undefined);

  try {
    return resolveAgent(name, config);
  } catch (error) {
    if (error instanceof UnknownAgentError) fail(error.message);
    throw error;
  }
}

/**
 * Where to run when --no-start left us without a freshly made worktree: the
 * ticket's worktree if it happens to exist, otherwise the repo itself.
 */
async function workingDirectory(worktreeDir: string, mainRoot: string | null): Promise<string> {
  try {
    await fs.access(worktreeDir);
    return worktreeDir;
  } catch {
    return mainRoot ?? process.cwd();
  }
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
      // Carry the agent's outcome, so `sabin run ... && ...` behaves
      process.exit(signal ? 1 : code ?? 0);
    });
  });
}
