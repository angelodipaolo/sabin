import fs from 'fs/promises';
import path from 'path';

/**
 * Write the project's VS Code workspace file.
 *
 * One file per project, not per ticket: it holds only the two permanent
 * folders, and the extension adds and removes ticket folders after them at
 * runtime. Folder 0 never changes, because VS Code restarts the extension
 * host when it does.
 */
export async function writeCodeWorkspace(
  sabinDir: string,
  projectRoot: string,
  projectName?: string
): Promise<string> {
  const name = projectName ?? path.basename(projectRoot);
  const target = path.join(sabinDir, `${name}.code-workspace`);

  const relativeToProject = path.relative(sabinDir, projectRoot) || '.';

  const contents = {
    folders: [
      { path: '.', name: 'sabin' },
      { path: relativeToProject, name }
    ],
    settings: {
      'files.exclude': {
        '**/.lock': true
      }
    }
  };

  await fs.writeFile(target, `${JSON.stringify(contents, null, 2)}\n`);
  return target;
}

export function codeWorkspacePath(sabinDir: string, projectRoot: string, projectName?: string): string {
  const name = projectName ?? path.basename(projectRoot);
  return path.join(sabinDir, `${name}.code-workspace`);
}
