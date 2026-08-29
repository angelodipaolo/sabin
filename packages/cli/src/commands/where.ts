import {
  mainWorktreeRoot,
  codeWorkspacePath,
  writeCodeWorkspace,
  planPath,
  feedbackPath,
  pathExists
} from '@sabin/core';
import { getWorkspace, loadProject, fail } from '../workspace-context';

interface WhereOptions {
  notes?: boolean;
  prompt?: boolean;
  plan?: boolean;
  feedback?: boolean;
  worktree?: boolean;
  task?: boolean;
  sabin?: boolean;
  codeWorkspace?: boolean;
}

/** Paths that belong to a ticket */
const TICKET_KEYS = ['notes', 'prompt', 'plan', 'feedback', 'worktree', 'task'] as const;
/** Paths that belong to the project, and so need no ticket */
const PROJECT_KEYS = ['sabin', 'codeWorkspace'] as const;

/**
 * Print a single path, for shell interpolation
 */
export async function where(ticket: string | undefined, options: WhereOptions): Promise<void> {
  const selected = [...TICKET_KEYS, ...PROJECT_KEYS].filter(key => options[key]);

  if (selected.length > 1) {
    fail('Pass at most one of --notes, --prompt, --plan, --feedback, --worktree, --task, --sabin, --code-workspace');
  }

  const choice = selected[0] ?? 'notes';

  // Resolve project paths without inferring a ticket - asking where .sabin
  // lives should not require being on a ticket branch
  if (choice === 'sabin' || choice === 'codeWorkspace') {
    return whereProject(choice);
  }

  const { workspace } = await getWorkspace(ticket);

  switch (choice) {
    case 'notes':
      console.log(workspace.notesDir);
      break;
    case 'prompt':
      console.log(workspace.promptFile);
      break;
    case 'plan':
      console.log(planPath(workspace.notesDir));
      break;
    case 'feedback':
      console.log(feedbackPath(workspace.notesDir));
      break;
    case 'worktree':
      console.log(workspace.worktreeDir);
      break;
    case 'task':
      if (!workspace.taskFile) fail(`No task file found for ${workspace.ticket}`);
      console.log(workspace.taskFile);
      break;
  }
}

async function whereProject(choice: 'sabin' | 'codeWorkspace'): Promise<void> {
  const { sabinDir, projectRoot } = await loadProject();

  if (choice === 'sabin') {
    console.log(sabinDir);
    return;
  }

  // Name the workspace after the main clone, so a worktree resolves to the
  // same file the main checkout does
  const mainRoot = await mainWorktreeRoot(process.cwd()) ?? projectRoot;
  const target = codeWorkspacePath(sabinDir, mainRoot);

  // Fully derived from config, so regenerate rather than fail on projects set
  // up before the file existed
  if (!(await pathExists(target))) {
    await writeCodeWorkspace(sabinDir, mainRoot);
  }

  console.log(target);
}

