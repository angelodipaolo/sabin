import fs from 'fs/promises';
import path from 'path';
import { SabinConfig } from './types';

const DEFAULT_CONFIG: SabinConfig = {
  projectPrefix: 'TASK',
  taskNumberPadding: 4
};

export function configPath(sabinDir: string): string {
  return path.join(sabinDir, 'config.json');
}

/**
 * Read config.json, layered over the defaults.
 *
 * A missing file means defaults. A file that cannot be parsed is an error,
 * not a silent fallback - defaulting the prefix because of a stray comma
 * would allocate task IDs under the wrong name.
 */
export async function readConfig(sabinDir: string): Promise<SabinConfig> {
  const file = configPath(sabinDir);

  let content: string;
  try {
    content = await fs.readFile(file, 'utf8');
  } catch (error: any) {
    if (error.code === 'ENOENT') return { ...DEFAULT_CONFIG };
    throw error;
  }

  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch (error: any) {
    throw new Error(`Could not parse ${file}: ${error.message}`, { cause: error });
  }
}

export async function writeConfig(config: SabinConfig, sabinDir: string): Promise<void> {
  await fs.mkdir(sabinDir, { recursive: true });
  await fs.writeFile(configPath(sabinDir), `${JSON.stringify(config, null, 2)}\n`);
}

export function getDefaultConfig(): SabinConfig {
  return { ...DEFAULT_CONFIG };
}
