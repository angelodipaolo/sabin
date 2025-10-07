import matter from 'gray-matter';
import fs from 'fs/promises';
import path from 'path';
import { Task, SabinConfig } from './types';
import { readConfig } from './config';

export async function parseTask(filePath: string): Promise<Task> {
  const content = await fs.readFile(filePath, 'utf8');
  const { data, content: body } = matter(content);

  return {
    status: data.status || 'open',
    title: data.title,
    plan: data.plan,
    content: body,
    path: filePath
  };
}

export async function writeTask(task: Task): Promise<void> {
  const { path: taskPath, content, ...frontmatter } = task;

  // Remove undefined values from frontmatter
  const cleanFrontmatter = Object.fromEntries(
    Object.entries(frontmatter).filter(([_, value]) => value !== undefined)
  );

  const fileContent = matter.stringify(content, cleanFrontmatter);
  await fs.writeFile(taskPath, fileContent);
}

export async function getNextTaskNumber(tasksDir: string, config?: SabinConfig): Promise<string> {
  // Read config if not provided
  const sabinDir = path.dirname(tasksDir);
  const actualConfig = config || await readConfig(sabinDir);

  const openDir = path.join(tasksDir, 'open');
  const completedDir = path.join(tasksDir, 'completed');

  let maxNumber = 0;

  try {
    const openFiles = await fs.readdir(openDir);
    const completedFiles = await fs.readdir(completedDir);
    const allFiles = [...openFiles, ...completedFiles];

    // Create regex pattern based on configured prefix
    const pattern = new RegExp(`^${actualConfig.projectPrefix}-(\\d+)\\.md$`);

    for (const file of allFiles) {
      const match = file.match(pattern);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) {
          maxNumber = num;
        }
      }
    }
  } catch (error) {
    // Directories might not exist yet
  }

  return String(maxNumber + 1).padStart(actualConfig.taskNumberPadding, '0');
}