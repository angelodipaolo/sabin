import { getWorkspace, fail } from '../workspace-context';

interface WhereOptions {
  notes?: boolean;
  prompt?: boolean;
  worktree?: boolean;
  task?: boolean;
  sabin?: boolean;
}

/**
 * Print a single path, for shell interpolation
 */
export async function where(ticket: string | undefined, options: WhereOptions): Promise<void> {
  const { workspace } = await getWorkspace(ticket);

  const selected = (['notes', 'prompt', 'worktree', 'task', 'sabin'] as const)
    .filter(key => options[key]);

  if (selected.length > 1) {
    fail(`Pass at most one of --notes, --prompt, --worktree, --task, --sabin`);
  }

  switch (selected[0] ?? 'notes') {
    case 'notes':
      console.log(workspace.notesDir);
      break;
    case 'prompt':
      console.log(workspace.promptFile);
      break;
    case 'worktree':
      console.log(workspace.worktreeDir);
      break;
    case 'sabin':
      console.log(workspace.sabinDir);
      break;
    case 'task':
      if (!workspace.taskFile) fail(`No task file found for ${workspace.ticket}`);
      console.log(workspace.taskFile);
      break;
  }
}
