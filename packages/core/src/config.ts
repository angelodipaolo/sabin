import fs from 'fs/promises';
import path from 'path';
import { SabinConfig } from './types';

const DEFAULT_CONFIG: SabinConfig = {
  projectPrefix: 'TASK',
  taskNumberPadding: 4
};

/**
 * Get the path to the config file
 */
function getConfigPath(sabinDir: string = '.sabin'): string {
  return path.join(sabinDir, 'config.json');
}

/**
 * Read the config file, returning default config if it doesn't exist
 */
export async function readConfig(sabinDir: string = '.sabin'): Promise<SabinConfig> {
  const configPath = getConfigPath(sabinDir);

  try {
    const content = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(content);

    // Merge with defaults to handle missing fields
    return {
      ...DEFAULT_CONFIG,
      ...config
    };
  } catch (error) {
    // If file doesn't exist or can't be read, return default config
    return DEFAULT_CONFIG;
  }
}

/**
 * Write the config file
 */
export async function writeConfig(config: SabinConfig, sabinDir: string = '.sabin'): Promise<void> {
  const configPath = getConfigPath(sabinDir);
  const content = JSON.stringify(config, null, 2);
  await fs.writeFile(configPath, content);
}

/**
 * Get the default config
 */
export function getDefaultConfig(): SabinConfig {
  return { ...DEFAULT_CONFIG };
}
