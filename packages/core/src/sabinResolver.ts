import fs from 'fs/promises';
import path from 'path';

export interface SabinLinkConfig {
  sabinDir: string;
}

/**
 * Resolve the actual .sabin directory path
 * Handles both file (link) and directory cases
 */
export async function resolveSabinDir(startDir: string = process.cwd()): Promise<{
  sabinDir: string;
  isLinked: boolean;
  projectRoot: string;
}> {
  const projectRoot = path.resolve(startDir);
  const sabinPath = path.join(projectRoot, '.sabin');

  try {
    const stat = await fs.stat(sabinPath);

    if (stat.isDirectory()) {
      // Traditional .sabin directory
      return {
        sabinDir: sabinPath,
        isLinked: false,
        projectRoot
      };
    } else if (stat.isFile()) {
      // .sabin file contains link to shared directory
      const content = await fs.readFile(sabinPath, 'utf8');
      const config: SabinLinkConfig = JSON.parse(content);

      if (!config.sabinDir) {
        throw new Error('.sabin file must contain "sabinDir" field');
      }

      const resolvedDir = path.resolve(projectRoot, config.sabinDir);
      return {
        sabinDir: resolvedDir,
        isLinked: true,
        projectRoot
      };
    } else {
      throw new Error('.sabin exists but is neither a file nor directory');
    }
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error('.sabin not found. Run "sabin init" first.');
    }
    throw error;
  }
}

/**
 * Write .sabin link file
 */
export async function writeSabinLink(projectRoot: string, targetSabinDir: string): Promise<void> {
  const sabinPath = path.join(projectRoot, '.sabin');

  // Calculate relative path from project to target .sabin
  const relativePath = path.relative(projectRoot, targetSabinDir);

  const config: SabinLinkConfig = {
    sabinDir: relativePath
  };

  const content = JSON.stringify(config, null, 2);
  await fs.writeFile(sabinPath, content);
}

/**
 * Check if .sabin exists and whether it's a file or directory
 */
export async function checkSabinType(projectRoot: string): Promise<'file' | 'directory' | 'none'> {
  const sabinPath = path.join(projectRoot, '.sabin');

  try {
    const stat = await fs.stat(sabinPath);
    if (stat.isFile()) return 'file';
    if (stat.isDirectory()) return 'directory';
    return 'none';
  } catch {
    return 'none';
  }
}
