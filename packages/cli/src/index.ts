#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { createTask } from './commands/create-task';
import { updateStatus } from './commands/update-status';
import { listTasks } from './commands/list-tasks';
import { initProject } from './commands/init';
import { installPrompts } from './commands/install-prompts';

const program = new Command();

program
  .name('sabin')
  .description('Workflow management CLI for agentic coding')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize Sabin in current directory')
  .requiredOption('-p, --prefix <prefix>', 'Project prefix for task IDs')
  .action(initProject);

const task = program
  .command('task')
  .description('Manage tasks');

task
  .command('create')
  .description('Create a new task')
  .option('-t, --title <title>', 'Task title')
  .option('-c, --content <content>', 'Task content')
  .option('-n, --number <number>', 'Custom task ID (e.g., JIRA-12345, NTVARCH-23252, or numeric)')
  .action(createTask);

task
  .command('update <id> <status>')
  .description('Update task status')
  .action(updateStatus);

task
  .command('list')
  .description('List all tasks')
  .option('-s, --status <status>', 'Filter by status (open/ready/in_progress/review/completed)')
  .action(listTasks);

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