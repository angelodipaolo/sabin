import chalk from 'chalk';
import {
  addRepo,
  createWorkspace,
  findRepo,
  getTask,
  listTasks,
  readConfig,
  repoForPath,
  NotAGitRepoError,
  RepoNotFoundError,
  Repo
} from '@sabin/core';
import { loadHome, fail, field, printJson, resolveTaskId } from '../cli';

export interface WorkOptions {
  repo?: string;
  json?: boolean;
}

/**
 * Create the task's worktree in one repo: `--repo`, else the repo of the cwd,
 * registering it on first use. Idempotent - a task that already has a
 * workspace in that repo gets it reported, and nothing is created.
 */
export async function work(id: string | undefined, options: WorkOptions = {}): Promise<void> {
  const { home, config } = await loadHome();
  const tasks = await listTasks(home);
  const taskId = await resolveTaskId(config, tasks, id, 'sabin work <id>');
  const task = await getTask(home, taskId);

  let repo: Repo | null;
  let registered = false;
  let current = config;

  if (options.repo) {
    repo = findRepo(config, options.repo);
    if (!repo) throw new RepoNotFoundError(options.repo);
  } else {
    repo = await repoForPath(config, process.cwd());
    if (!repo) {
      let added;
      try {
        added = await addRepo(home, process.cwd());
      } catch (error) {
        if (error instanceof NotAGitRepoError) {
          fail(`Not inside a git repository: ${process.cwd()}. Run this from a repo, or pass --repo <name> (see \`sabin repo ls\`).`);
        }
        throw error;
      }
      registered = added.added;
      current = await readConfig(home);
      repo = findRepo(current, added.repo.name);
      if (!repo) fail(`Registered ${added.repo.name}, but could not read it back from config.json.`);
    }
  }

  const result = await createWorkspace(current, task, repo);
  const failed = result.postCreate.find(entry => !entry.ok);
  if (failed) process.exitCode = 1;

  if (options.json) {
    printJson({
      id: task.id,
      repo: repo.name,
      path: result.workspace.path,
      branch: result.workspace.branch,
      created: result.created,
      registered,
      postCreate: result.postCreate.map(entry => ({ command: entry.command, ok: entry.ok, output: entry.output }))
    });
    return;
  }

  if (registered) console.log(`${chalk.green('Registered')} repo ${chalk.bold(repo.name)}  ${repo.path}`);
  const verb = result.created ? chalk.green('Created worktree') : chalk.yellow('Worktree already exists');
  console.log(`${verb} for ${chalk.bold(task.id)} in ${chalk.bold(repo.name)}`);
  console.log(field('Path', result.workspace.path));
  console.log(field('Branch', result.workspace.branch));

  if (result.created) {
    if (repo.postCreate.length === 0) {
      console.log(field('postCreate', chalk.gray('none configured')));
    } else {
      for (const entry of result.postCreate) {
        const mark = entry.ok ? chalk.green('ok    ') : chalk.red('failed');
        console.log(field('postCreate', `${mark} ${entry.command}`));
        if (!entry.ok && entry.output.trim()) {
          for (const line of entry.output.trim().split('\n').slice(-20)) console.log(`      ${chalk.gray(line)}`);
        }
      }
      const skipped = repo.postCreate.slice(result.postCreate.length);
      for (const command of skipped) console.log(field('postCreate', `${chalk.gray('skipped')} ${command}`));
    }
  }

  if (failed) console.error(chalk.red(`postCreate failed: ${failed.command}. The worktree is there; finish the setup by hand.`));
}
