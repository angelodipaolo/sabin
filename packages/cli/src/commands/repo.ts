import path from 'path';
import chalk from 'chalk';
import { addRepo, listRepos, removeRepo, setRepoProject, NotAGitRepoError } from '@sabin/core';
import { loadHome, fail, field } from '../cli';

export interface RepoAddOptions {
  /** Default project for work in this repo */
  project?: string;
}

/**
 * Register the repo containing `dir` (default: the cwd). A worktree registers
 * its main clone. `--project` sets the default project, also on a repo that
 * is already registered.
 */
export async function repoAdd(dir?: string, options: RepoAddOptions = {}): Promise<void> {
  const target = path.resolve(dir ?? process.cwd());
  const { home } = await loadHome();

  let result;
  try {
    result = await addRepo(home, target, { project: options.project });
  } catch (error) {
    if (error instanceof NotAGitRepoError) fail(`Not a git repository: ${target}`);
    throw error;
  }

  const { repo, added } = result;
  console.log(added
    ? `${chalk.green('Registered')} ${chalk.bold(repo.name)}`
    : `${chalk.yellow('Already registered')} as ${chalk.bold(repo.name)}`);
  console.log(field('Path', repo.path));
  console.log(field('Worktrees', repo.worktreesRoot));
  console.log(field('Project', repo.project ?? chalk.gray(`none. Set a default with: sabin repo set ${repo.name} --project <slug>`)));
}

export interface RepoSetOptions {
  /** A slug, or false for `--no-project` */
  project?: string | false;
}

/** Change a registered repo's settings. Today that is only its default project. */
export async function repoSet(name: string, options: RepoSetOptions = {}): Promise<void> {
  if (options.project === undefined) fail('Nothing to set. Pass --project <slug> or --no-project.');
  const { home } = await loadHome();
  const repo = await setRepoProject(home, name, options.project === false ? null : options.project);
  console.log(repo.project
    ? `${chalk.green('Set')} the default project of ${chalk.bold(repo.name)} to ${chalk.bold(repo.project)}`
    : `${chalk.green('Cleared')} the default project of ${chalk.bold(repo.name)}`);
  console.log(chalk.gray(repo.project
    ? 'Outside a task\'s worktree, sabin context, ls and new in this repo now use it.'
    : 'Only tasks name a project here now. Worktrees still answer through their task.'));
}

/** Every registered repo */
export async function repoLs(): Promise<void> {
  const { config } = await loadHome();
  const repos = listRepos(config);
  if (repos.length === 0) {
    console.log('No repos registered. Register one with: sabin repo add [path]');
    return;
  }

  const width = Math.max(4, ...repos.map(repo => repo.name.length));
  console.log(chalk.gray(`${'NAME'.padEnd(width)}  PATH`));
  for (const repo of repos) {
    console.log(`${chalk.bold(repo.name.padEnd(width))}  ${repo.path}`);
    console.log(`${' '.repeat(width)}  ${chalk.gray(`worktrees ${repo.worktreesRoot}`)}`);
    if (repo.project) console.log(`${' '.repeat(width)}  ${chalk.gray(`project ${repo.project}`)}`);
    for (const command of repo.postCreate) {
      console.log(`${' '.repeat(width)}  ${chalk.gray(`postCreate ${command}`)}`);
    }
  }
}

/** Unregister a repo. Its clone and worktrees are left exactly as they are. */
export async function repoRm(name: string): Promise<void> {
  const { home } = await loadHome();
  const repo = await removeRepo(home, name);
  console.log(`${chalk.green('Unregistered')} ${chalk.bold(repo.name)}`);
  console.log(field('Path', repo.path));
  console.log(chalk.gray('Nothing on disk was touched. Its worktrees no longer appear in sabin ls.'));
}
