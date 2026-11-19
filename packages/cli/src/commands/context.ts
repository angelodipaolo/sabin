import path from 'path';
import chalk from 'chalk';
import {
  findLog,
  findPlan,
  getTask,
  listNotes,
  listRepos,
  listTasks,
  listWorkspaces,
  projectForPath,
  reposForProject,
  resolveHome,
  PathProject,
  ProjectSource,
  Task
} from '@sabin/core';
import { loadHome, field, printJson, resolveTaskId, containingWorkspace, colorStatus } from '../cli';

export interface ContextOptions {
  json?: boolean;
}

/** The keys `context --json` returns, in order. prompt.md is deliberately absent. */
export const CONTEXT_KEYS = [
  'id', 'title', 'status', 'project', 'projectSource', 'projectRepos', 'candidateProjects', 'repo',
  'home', 'taskDir', 'taskFile', 'plan', 'log', 'notes', 'workspaces', 'workspace'
] as const;

/**
 * The agent's orienting call: the task, its files and its workspaces, and the
 * project. The task is the one given, else the one whose worktree holds the
 * cwd. Outside every task's worktree it still answers, with `id: null`: the
 * project comes from the repo's default, or `candidateProjects` lists the
 * choices. Never includes prompt.md - that is the human's scratchpad.
 */
export async function context(id: string | undefined, options: ContextOptions = {}): Promise<void> {
  const { home, config } = await loadHome();
  const tasks = await listTasks(home);

  const located = await projectForPath(config, tasks, process.cwd());
  const taskId = id ? await resolveTaskId(config, tasks, id, 'sabin context <id>') : located.taskId;

  const task = taskId ? await getTask(home, taskId) : null;
  // A named task answers with its own project; the cwd only fills in when it is the cwd's task
  let project: string | null;
  let source: ProjectSource | null;
  if (task && task.id !== located.taskId) {
    project = task.project ?? null;
    source = task.project ? 'task' : null;
  } else {
    project = located.project;
    source = located.source;
  }

  const allWorkspaces = await listWorkspaces(config, tasks);
  const workspaces = task ? allWorkspaces.filter(workspace => workspace.taskId === task.id) : [];
  const projectRepos = project ? reposForProject(project, tasks, allWorkspaces, listRepos(config)) : [];
  const candidates = project ? [] : located.candidates;
  const here = await containingWorkspace(workspaces, process.cwd());
  const brief = (w: { repo: string; path: string; branch: string }) => ({ repo: w.repo, path: w.path, branch: w.branch });

  const [plan, log, notes] = task
    ? await Promise.all([findPlan(task.dir), findLog(task.dir), listNotes(task.dir)])
    : [null, null, [] as string[]];

  const result = {
    id: task?.id ?? null,
    title: task?.title ?? null,
    status: task?.status ?? null,
    project,
    projectSource: source,
    projectRepos,
    candidateProjects: candidates,
    repo: located.repo?.name ?? null,
    home: resolveHome(),
    taskDir: task?.dir ?? null,
    taskFile: task?.file ?? null,
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

  if (!task) {
    printNoTask(tasks, located, project, projectRepos);
    return;
  }

  console.log(`${chalk.bold(task.id)}  ${task.title}`);
  console.log(field('Status', colorStatus(task.status)));
  if (project) console.log(field('Project', `${project}${source === 'repo' ? chalk.gray(` (default of repo ${located.repo?.name})`) : ''}`));
  if (projectRepos.length > 1) console.log(field('Spans', projectRepos.join(', ')));
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

/** Outside every task's worktree: where you are, the project if one applies, and what to run */
function printNoTask(tasks: Task[], located: PathProject, project: string | null, projectRepos: string[]): void {
  console.log(`No task here: ${process.cwd()} is not inside a task's worktree.`);
  if (!located.repo) {
    console.log(field('Repo', chalk.gray('none. Register this repo with: sabin repo add')));
    console.log('Pass an ID for a task: sabin context <id>');
    return;
  }

  console.log(field('Repo', located.repo.name));
  if (project) {
    const open = tasks.filter(task => task.project === project && task.status !== 'completed').length;
    console.log(field('Project', `${project}${chalk.gray(' (repo default)')}`));
    if (projectRepos.length > 1) console.log(field('Spans', projectRepos.join(', ')));
    console.log(field('Tasks', `${open} open. List them with: sabin ls`));
  } else {
    const choices = located.candidates.length ? `. Projects with worktrees here: ${located.candidates.join(', ')}` : '';
    console.log(field('Project', chalk.gray(`none${choices}`)));
    console.log(chalk.gray(`Set a default with: sabin repo set ${located.repo.name} --project <slug>`));
  }
  console.log('Pass an ID for a task: sabin context <id>');
}
