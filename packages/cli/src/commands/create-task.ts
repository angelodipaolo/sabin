import chalk from 'chalk';
import {
  createTask as createTaskFile,
  slugify,
  slugFromTitle,
  workspacePaths,
  scaffoldWorkspace,
  mainWorktreeRoot,
  TaskExistsError
} from '@sabin/core';
import { loadProject, fail } from '../workspace-context';
import { launchEditor } from '../editor';

interface CreateTaskOptions {
  title?: string;
  content?: string;
  number?: string;
  slug?: string;
  open?: boolean;
  editor?: string;
  json?: boolean;
}

/**
 * Create a task and, in the same breath, its notes directory and prompt
 * scratchpad - so context can start accumulating before any work does.
 *
 * Prints the bare ID last so `sabin start $(sabin task create "...")` works.
 */
export async function createTask(titleArg: string | undefined, options: CreateTaskOptions): Promise<void> {
  const title = (titleArg ?? options.title ?? '').trim();
  if (!title) {
    fail('A title is required:  sabin task create "Add telemetry"');
  }

  const { sabinDir, projectRoot, config } = await loadProject();

  let task;
  try {
    task = await createTaskFile(sabinDir, config, {
      title,
      content: options.content,
      id: options.number,
      slug: options.slug ? slugify(options.slug) : undefined
    });
  } catch (error) {
    if (error instanceof TaskExistsError) fail(error.message);
    throw error;
  }

  const slug = task.slug ?? slugFromTitle(task.title, config);
  const paths = workspacePaths(
    { ticket: task.id, slug },
    sabinDir,
    await mainWorktreeRoot(projectRoot),
    config
  );
  await scaffoldWorkspace(paths, task.title);

  if (options.json) {
    console.log(JSON.stringify({
      ticket: task.id,
      name: paths.name,
      title: task.title,
      taskFile: task.path,
      notesDir: paths.notesDir,
      promptFile: paths.promptFile
    }, null, 2));
  } else {
    console.error(chalk.green(`Created ${task.id}`) + chalk.gray(` · ${task.title}`));
    console.error(chalk.gray(`  Task:   ${task.path}`));
    console.error(chalk.gray(`  Notes:  ${paths.notesDir}`));
    console.error(chalk.gray(`  Prompt: ${paths.promptFile}`));
    console.log(task.id);
  }

  if (options.open) {
    await launchEditor(task.path, { editor: options.editor, quiet: true });
  }
}
