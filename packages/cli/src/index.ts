#!/usr/bin/env node
import { Command } from 'commander';
import { WorkflowStep } from '@sabin/core';
import { createTask } from './commands/create-task';
import { updateStatus } from './commands/update-status';
import { listTasks } from './commands/list-tasks';
import { initProject } from './commands/init';
import { linkToSharedSabin } from './commands/link';
import { installSkill } from './commands/install-skill';
import { showContext } from './commands/context';
import { where } from './commands/where';
import { showTask } from './commands/show-task';
import { runStep, StepOptions } from './commands/agent-step';
import { notesNew } from './commands/notes';
import { open } from './commands/open';

const program = new Command();

program
  .name('sabin')
  .description('Worktree command center for agentic coding')
  .version('0.1.0');

program
  .command('init')
  .description('Set up Sabin for the repo you are in')
  .option('-p, --prefix <prefix>', 'Project prefix for task IDs')
  .option('-s, --shared <path>', 'Where the Sabin directory lives (outside the repo)')
  .option('-b, --branch-prefix <prefix>', 'Personal branch prefix, e.g. angelo')
  .option('-w, --worktrees <path>', 'Worktree root, relative to the repo')
  .option('--no-exclude', 'Do not add .sabin to .git/info/exclude')
  .action(initProject);

program
  .command('link')
  .description('Point this repo at an existing Sabin directory')
  .argument('<path>', 'Path to the Sabin directory')
  .action(linkToSharedSabin);

/**
 * The three ways an agent gets put on a ticket.
 *
 * Registered from one definition so they cannot drift apart - same flags,
 * same behaviour, only the step differs. Each one creates the worktree if it
 * is not there and starts the agent inside it; `sabin task create` is the
 * only thing that does not, because drafting a task is not working on one.
 */
const STEPS: Array<{ step: WorkflowStep; summary: string }> = [
  { step: 'plan', summary: 'Work through a ticket with an agent and write its plan' },
  { step: 'implement', summary: 'Put an agent on a ticket to do the work' },
  { step: 'review', summary: "Have an agent review the ticket's changes" }
];

for (const { step, summary } of STEPS) {
  program
    .command(step)
    .description(`${summary} (creates the worktree if needed)`)
    .argument('[ticket]', 'Ticket ID (inferred from the current branch if omitted)')
    .option('-a, --agent <name>', 'Agent to launch (default: claude)')
    .option('--claude', 'Shorthand for --agent claude')
    .option('--codex', 'Shorthand for --agent codex')
    .option('--tab', 'Launch in a new iTerm2 tab (the default under iTerm2)')
    .option('--here', 'Launch in this tab instead of a new one')
    .option('--yolo', 'Let the agent work without asking permission')
    .option('--supervised', 'Make the agent ask, overriding agents.autonomous')
    .option('--print', 'Print the composed prompt and exit, without starting anything')
    .option('--no-launch', 'Create the workspace but start no agent')
    .option('--no-start', 'Do not create the worktree or change status first')
    .action((ticket: string | undefined, options: StepOptions) => runStep(step, ticket, options));
}

program
  .command('open')
  .description('Open the project in your editor (board, notes and prompts in one window)')
  .argument('[ticket]', 'Ticket ID (inferred from the current branch if omitted)')
  .option('--worktree', "Open the ticket's worktree instead")
  .option('--notes', "Open the ticket's notes directory instead")
  .option('--prompt', "Open the ticket's prompt scratchpad instead")
  .option('--plan', "Open the ticket's plan instead")
  .option('--feedback', "Open the ticket's review feedback instead")
  .option('--task', 'Open the task file instead')
  .option('--sabin', 'Open the Sabin directory instead')
  .option('-n, --new-window', 'Force a new editor window')
  .option('--no-reveal', 'Do not focus the Sabin sidebar after opening')
  .option('-e, --editor <command>', 'Editor command (default: code)')
  .action(open);

program
  .command('context')
  .description('Show the current workspace: ticket, branch, worktree, notes and prompt paths')
  .option('--json', 'Output machine-readable JSON')
  .option('-t, --ticket <ticket>', 'Override branch inference')
  .action(showContext);

program
  .command('where')
  .description('Print a single workspace path, for shell interpolation')
  .argument('[ticket]', 'Ticket ID (inferred from the current branch if omitted)')
  .option('--notes', 'Path to the ticket notes directory (default)')
  .option('--prompt', 'Path to the ticket prompt scratchpad')
  .option('--plan', 'Path to the ticket plan')
  .option('--feedback', 'Path to the ticket feedback file')
  .option('--worktree', 'Path to the ticket worktree')
  .option('--task', 'Path to the task file')
  .option('--sabin', 'Path to the resolved Sabin directory')
  .option('--code-workspace', 'Path to the project VS Code workspace file')
  .action(where);

const task = program
  .command('task')
  .description('Manage tasks');

task
  .command('create')
  .description('Create a task, with its notes directory and prompt scratchpad')
  .argument('[title]', 'Task title')
  .option('-t, --title <title>', 'Task title (alternative to the argument)')
  .option('-c, --content <content>', 'Task body')
  .option('-n, --number <id>', 'Explicit ID, e.g. JIRA-12345 (default: next in sequence)')
  .option('--slug <slug>', 'Descriptive suffix for branch, notes and worktree names')
  .option('-o, --open', 'Open the task file in your editor to write the requirements')
  .option('-e, --editor <command>', 'Editor command (default: code)')
  .option('--json', 'Output machine-readable JSON')
  .action(createTask);

task
  .command('update <id> <status>')
  .description('Change task status; prints the project hook for that status, if any')
  .option('--json', 'Output machine-readable JSON')
  .action(updateStatus);

task
  .command('show')
  .description('Print a task file')
  .argument('[id]', 'Task ID (inferred from the current branch if omitted)')
  .action(showTask);

task
  .command('list')
  .description('List tasks (completed hidden unless --all or -s completed)')
  .option('-s, --status <status>', 'Filter by status (open/ready/in_progress/review/completed)')
  .option('-a, --all', 'Include completed tasks')
  .option('--json', 'Output machine-readable JSON')
  .action(listTasks);

const notes = program
  .command('notes')
  .description('Work with ticket notes');

notes
  .command('new')
  .description('Scaffold a note in the ticket notes directory and print its path')
  .argument('<name>', 'Note filename, e.g. research, schema.json, data.csv (defaults to .md)')
  .option('--template <template>', 'Seed from a template (plan, feedback)')
  .option('-t, --ticket <ticket>', 'Override branch inference')
  .action(notesNew);

const skill = program
  .command('skill')
  .description('Manage the agent skill');

skill
  .command('install')
  .description('Install the sabin skill for an agent (claude or codex)')
  .option('-a, --agent <agent>', 'Target agent', 'claude')
  .action(installSkill);

// Kept for muscle memory; `skill install` is the name
program
  .command('prompts', { hidden: true })
  .command('install')
  .option('-a, --agent <agent>', 'Target agent', 'claude')
  .action(installSkill);

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}
