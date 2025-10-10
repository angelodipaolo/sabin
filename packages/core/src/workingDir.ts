import path from 'path';

/**
 * Get the relative working directory name from a project root
 * relative to the .sabin parent directory
 *
 * Example:
 *   sabinDir: /projects/.sabin
 *   projectRoot: /projects/project-1
 *   Returns: project-1
 */
export function getWorkingDirName(sabinDir: string, projectRoot: string): string {
  const sabinParent = path.dirname(sabinDir);
  const relativePath = path.relative(sabinParent, projectRoot);

  // If same directory, return '.'
  if (relativePath === '') {
    return '.';
  }

  return relativePath;
}
