#!/usr/bin/env node
import { Command } from 'commander';
import { createTask } from './commands/create-task';
import { updateStatus } from './commands/update-status';
import { listTasks } from './commands/list-tasks';
import { initProject } from './commands/init';
import { linkToSharedSabin } from './commands/link';
import { installPrompts } from './commands/install-prompts';
import { showContext } from './commands/context';
import { where } from './commands/where';
import { showTask } from './commands/show-task';
import { startTask } from './commands/start';
import { finishTask } from './commands/finish';
import { notesNew } from './commands/notes';

const program = new Command();

program
  .name('sabin')
  .description('Workflow management CLI for agentic coding')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize Sabin in current directory')
  .option('-p, --prefix <prefix>', 'Project prefix for task IDs')
  .option('-s, --shared <path>', 'Create or reuse a shared .sabin at this path and link to it')
  .option('--local', 'Keep .sabin inside the repo (skips the prompt)')
  .option('-b, --branch-prefix <prefix>', 'Personal branch prefix, e.g. angelo')
  .option('-w, --worktrees <path>', 'Worktree root, relative to the repo')
  .option('--no-exclude', 'Do not add .sabin to .git/info/exclude')
  .action(initProject);

program
  .command('link')
  .description('Link to a shared .sabin directory')
  .argument('<path>', 'Path to shared .sabin directory')
  .action(linkToSharedSabin);

program
  .command('start')
  .description('Create the worktree, branch, notes directory and prompt file for a ticket')
  .argument('<ticket>', 'Ticket, optionally with a description (e.g. JIRA-12345-update-telemetry)')
  .option('-t, --title <title>', 'Task title, when creating the task')
  .option('--json', 'Output machine-readable JSON')
  .option('--no-worktree', 'Skip worktree and branch creation')
  .action(startTask);

program
  .command('finish')
  .description('Mark a ticket completed and remove its worktree')
  .argument('[ticket]', 'Ticket ID (inferred from the current branch if omitted)')
  .option('--keep-worktree', 'Leave the worktree in place')
  .option('--json', 'Output machine-readable JSON')
  .action(finishTask);

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
  .option('--worktree', 'Path to the ticket worktree')
  .option('--task', 'Path to the task file')
  .option('--sabin', 'Path to the resolved .sabin directory')
  .action(where);

const task = program
  .command('task')
  .description('Manage tasks');

task
  .command('create')
  .description('Create a new task')
  .option('-t, --title <title>', 'Task title')
  .option('-c, --content <content>', 'Task content')
  .option('-n, --number <number>', 'Custom task ID (e.g., JIRA-12345, NTVARCH-23252, or numeric)')
  .option('--slug <slug>', 'Descriptive suffix for branch, notes and worktree names')
  .action(createTask);

task
  .command('update <id> <status>')
  .description('Update task status')
  .option('--json', 'Output machine-readable JSON')
  .action(updateStatus);

task
  .command('show')
  .description('Print a task file')
  .argument('[id]', 'Task ID (inferred from the current branch if omitted)')
  .action(showTask);

task
  .command('list')
  .description('List all tasks')
  .option('-s, --status <status>', 'Filter by status (open/ready/in_progress/review/completed)')
  .action(listTasks);

const notes = program
  .command('notes')
  .description('Work with ticket notes');

notes
  .command('new')
  .description('Scaffold a note in the ticket notes directory and print its path')
  .argument('<name>', 'Note filename, e.g. plan or research.md')
  .option('--template <template>', 'Seed from a template (plan)')
  .option('-t, --ticket <ticket>', 'Override branch inference')
  .action(notesNew);

const prompts = program
  .command('prompts')
  .description('Manage AI agent prompts');

prompts
  .command('install')
  .description('Install Sabin workflow prompts as slash commands for AI coding agents')
  .option('-a, --agent <agent>', 'Target agent (default: claude)', 'claude')
  .action(installPrompts);

program.parse();

if (!process.argv.slice(2).length) {
  program.outputHelp();
}