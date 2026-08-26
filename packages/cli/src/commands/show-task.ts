import fs from 'fs/promises';
import { getWorkspace, fail } from '../workspace-context';

/**
 * Print a task file without needing to know which status directory it is in
 */
export async function showTask(ticket: string | undefined): Promise<void> {
  const { workspace } = await getWorkspace(ticket);

  if (!workspace.taskFile) {
    fail(`No task file found for ${workspace.ticket}`);
  }

  console.log(await fs.readFile(workspace.taskFile, 'utf8'));
}
