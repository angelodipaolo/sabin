import path from 'path';
import chalk from 'chalk';
import { addRepo, listRepos, removeRepo, NotAGitRepoError } from '@sabin/core';
import { loadHome, fail, field } from '../cli';

/** Register the repo containing `dir` (default: the cwd). A worktree registers its main clone. */
export async function repoAdd(dir?: string): Promise<void> {
  const target = path.resolve(dir ?? process.cwd());
  const { home } = await loadHome();

  let result;
  try {
    result = await addRepo(home, target);
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
