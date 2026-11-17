import path from 'path';
import chalk from 'chalk';
import {
  findLog,
  findPlan,
  getTask,
  listNotes,
  listTasks,
  resolveHome,
  workspacesForTask
} from '@sabin/core';
import { loadHome, field, printJson, resolveTaskId, containingWorkspace, colorStatus } from '../cli';

export interface ContextOptions {
  json?: boolean;
}

/** The keys `context --json` returns, in order. prompt.md is deliberately absent. */
export const CONTEXT_KEYS = [
  'id', 'title', 'status', 'project', 'home', 'taskDir', 'taskFile', 'plan', 'log', 'notes', 'workspaces', 'workspace'
] as const;

/**
 * The agent's orienting call: the task, its files and its workspaces. The
 * task is the one given, else the one whose worktree holds the cwd. Never
 * includes prompt.md - that is the human's scratchpad.
 */
export async function context(id: string | undefined, options: ContextOptions = {}): Promise<void> {
  const { home, config } = await loadHome();
  const tasks = await listTasks(home);
  const taskId = await resolveTaskId(config, tasks, id, 'sabin context <id>');
  const task = await getTask(home, taskId);

  const [plan, log, notes, workspaces] = await Promise.all([
    findPlan(task.dir),
    findLog(task.dir),
    listNotes(task.dir),
    workspacesForTask(config, task.id)
  ]);
  const here = await containingWorkspace(workspaces, process.cwd());
  const brief = (w: { repo: string; path: string; branch: string }) => ({ repo: w.repo, path: w.path, branch: w.branch });

  const result = {
    id: task.id,
    title: task.title,
    status: task.status,
    project: task.project ?? null,
    home: resolveHome(),
    taskDir: task.dir,
    taskFile: task.file,
    plan,
    log,
    notes,
    workspaces: workspaces.map(brief),
    workspace: here ? brief(here) : null
  };

  if (options.json) {
    printJson(result);
    return;
  }

  console.log(`${chalk.bold(task.id)}  ${task.title}`);
  console.log(field('Status', colorStatus(task.status)));
  if (task.project) console.log(field('Project', task.project));
  console.log(field('Task dir', task.dir));
  console.log(field('Plan', plan ? path.basename(plan) : chalk.gray('none')));
  console.log(field('Log', log ? path.basename(log) : chalk.gray('none')));
  console.log(field('Notes', notes.length ? notes.map(note => path.basename(note)).join(', ') : chalk.gray('none')));
  if (workspaces.length === 0) {
    console.log(field('Worktrees', chalk.gray(`none. Create one with: sabin work ${task.id}`)));
    return;
  }
  console.log(field('Worktrees', '').trimEnd());
  for (const workspace of workspaces) {
    const mark = here && here.path === workspace.path ? chalk.green(' (here)') : '';
    console.log(`    ${chalk.cyan(workspace.repo)}  ${workspace.branch}  ${workspace.path}${mark}`);
  }
}
