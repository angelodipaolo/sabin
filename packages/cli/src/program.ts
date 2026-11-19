import { Command } from 'commander';
import chalk from 'chalk';
import { errorLine } from './cli';
import { setup } from './commands/setup';
import { newTask } from './commands/new';
import { work } from './commands/work';
import { ls } from './commands/ls';
import { status } from './commands/status';
import { context } from './commands/context';
import { repoAdd, repoLs, repoRm, repoSet } from './commands/repo';
import { app } from './commands/app';
import { agentState } from './commands/agent-state';

export function buildProgram(): Command {
  const program = new Command();

  program
    .name('sabin')
    .description('Every task, every repo, every agent: where each was left off.')
    .version('0.1.0')
    .showHelpAfterError()
    // Show each command as it is typed: `status [id] <status>`, not its raw arguments
    .configureHelp({ subcommandTerm: cmd => `${cmd.name()} ${cmd.usage()}`.trim() });

  program
    .command('setup')
    .description('Set up the home, the skill and agent settings')
    .option('--hooks', 'Also install the agent activity hooks (Claude Code and Codex)')
    .action(options => setup(options));

  program
    .command('new')
    .description('Create a task (never a worktree)')
    .argument('<title>', 'Task title')
    .option('--id <id>', 'Use an external ID, e.g. ARCH-1234')
    .option('-p, --project <slug>', 'Put the task in a project (default: the project of this directory)')
    .option('--no-project', 'No project, even where one applies')
    .option('-c, --content <body>', 'Body of task.md')
    .option('--json', 'Print JSON')
    .action((title, options) => newTask(title, options));

  program
    .command('work')
    .description("Create a task's worktree in this repo")
    .argument('[id]', 'Task ID (default: the task of this worktree)')
    .option('-r, --repo <name>', 'A registered repo, instead of the one you are in')
    .option('--json', 'Print JSON')
    .action((id, options) => work(id, options));

  program
    .command('ls')
    .description('List tasks, worktrees and agent activity')
    .option('-p, --project <slug>', 'Only this project (default: the project of this directory)')
    .option('-P, --all-projects', 'Every project, even where one applies')
    .option('-s, --status <status>', 'Only this status')
    .option('-a, --all', 'Include completed tasks')
    .option('--json', 'Print JSON')
    .action(options => ls(options));

  program
    .command('status')
    .description('Set a task status; prints the hook')
    .argument('<id-or-status>', 'Task ID; omit it inside the task worktree')
    .argument('[status]', 'open, ready, in_progress, review or completed')
    .usage('[id] <status>')
    .action((first, second) => status(first, second));

  program
    .command('context')
    .description("Task, project, files and worktrees (for agents)")
    .argument('[id]', 'Task ID (default: the task of this worktree; none outside one)')
    .option('--json', 'Print JSON')
    .action((id, options) => context(id, options));

  const repo = program
    .command('repo')
    .description('Manage the registered repos');
  repo
    .command('add')
    .description('Register a repo (default: the one you are in)')
    .argument('[path]', 'Path inside the repo')
    .option('-p, --project <slug>', 'Default project for work in this repo')
    .action((dir, options) => repoAdd(dir, options));
  repo
    .command('set')
    .description("Change a repo's default project")
    .argument('<name>', 'Repo name, from `sabin repo ls`')
    .option('-p, --project <slug>', 'Default project for work in this repo')
    .option('--no-project', 'Clear the default; only tasks name a project')
    .action((name, options) => repoSet(name, options));
  repo
    .command('ls')
    .description('List registered repos')
    .action(() => repoLs());
  repo
    .command('rm')
    .description('Unregister a repo (touches nothing on disk)')
    .argument('<name>', 'Repo name, from `sabin repo ls`')
    .action(name => repoRm(name));

  program
    .command('app')
    .description('Open the desktop app')
    .option('-t, --task <id>', 'Open on this task')
    .action(options => app(options));

  // What the activity hooks run. index.ts normally takes a faster path.
  program
    .command('agent-state', { hidden: true })
    .allowExcessArguments(true)
    .action(() => agentState());

  return program;
}

export async function run(argv: string[]): Promise<void> {
  const program = buildProgram();
  if (argv.length <= 2) {
    program.outputHelp();
    return;
  }
  try {
    await program.parseAsync(argv);
  } catch (error) {
    console.error(chalk.red(errorLine(error)));
    process.exitCode = 1;
  }
}
