import fs from 'fs/promises';
import path from 'path';
import { PROJECT_STATUSES, ProjectStatus, Task, TaskStatus, TASK_STATUSES } from './types';
import { homePaths } from './home';
import { parseFrontmatter, stringifyFrontmatter } from './markdown';
import { parseProjectSlug } from './slug';
import { writeFileAtomic, pathExists } from './fs';
import { listTasks } from './tasks';
import { InvalidProjectError, ProjectExistsError } from './errors';

export interface Project {
  slug: string;
  /** From the file; the slug when there is no file */
  title: string;
  /** From the file; `active` when there is no file or no status */
  status: ProjectStatus;
  /** projects/<slug>.md, or null for a project implied only by its tasks */
  file: string | null;
  /** The file's prose body; empty when there is no file */
  content: string;
  /** Tasks naming this project, by status */
  counts: Record<TaskStatus, number>;
  /** All tasks naming this project */
  total: number;
}

export function projectFilePath(home: string, slug: string): string {
  const safe = parseProjectSlug(slug);
  if (!safe) throw new InvalidProjectError(slug);
  return path.join(homePaths(home).projectsDir, `${safe}.md`);
}

function emptyCounts(): Record<TaskStatus, number> {
  return Object.fromEntries(TASK_STATUSES.map(status => [status, 0])) as Record<TaskStatus, number>;
}

async function readProjectFile(file: string, slug: string): Promise<Project> {
  const { data, content } = parseFrontmatter(await fs.readFile(file, 'utf8'));
  const status = (PROJECT_STATUSES as readonly unknown[]).includes(data.status) ? data.status as ProjectStatus : 'active';
  return {
    slug,
    title: typeof data.title === 'string' && data.title.trim() ? data.title.trim() : slug,
    status,
    file,
    content,
    counts: emptyCounts(),
    total: 0
  };
}

function impliedProject(slug: string): Project {
  return { slug, title: slug, status: 'active', file: null, content: '', counts: emptyCounts(), total: 0 };
}

/**
 * Every project, sorted by slug: each projects/<slug>.md, plus each slug a
 * task names without a file. Pass `tasks` when you already have them to
 * avoid a second read. An unreadable project file degrades to an implied
 * project rather than disappearing.
 */
export async function listProjects(home: string, tasks?: Task[]): Promise<Project[]> {
  const projects = new Map<string, Project>();

  let names: string[] = [];
  try {
    names = (await fs.readdir(homePaths(home).projectsDir)).filter(name => name.endsWith('.md'));
  } catch {
    // No projects directory yet
  }

  for (const name of names) {
    const slug = parseProjectSlug(name.slice(0, -3));
    // Only files whose name is already a slug - anything else could not be named by a task
    if (!slug || `${slug}.md` !== name) continue;
    const file = path.join(homePaths(home).projectsDir, name);
    projects.set(slug, await readProjectFile(file, slug).catch(() => impliedProject(slug)));
  }

  for (const task of tasks ?? await listTasks(home)) {
    if (!task.project) continue;
    const project = projects.get(task.project) ?? impliedProject(task.project);
    project.counts[task.status] += 1;
    project.total += 1;
    projects.set(task.project, project);
  }

  return [...projects.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** One project, file-backed or implied, or null when neither */
export async function findProject(home: string, slug: string, tasks?: Task[]): Promise<Project | null> {
  const wanted = parseProjectSlug(slug);
  if (!wanted) throw new InvalidProjectError(slug);
  return (await listProjects(home, tasks)).find(project => project.slug === wanted) ?? null;
}

export interface CreateProjectOptions {
  title: string;
  /** Defaults to the slug of the title */
  slug?: string;
  status?: ProjectStatus;
  content?: string;
}

/**
 * Write projects/<slug>.md. A project implied by tasks can be given a file
 * this way; one that already has a file is an error.
 */
export async function createProject(home: string, options: CreateProjectOptions): Promise<Project> {
  const slug = parseProjectSlug(options.slug ?? options.title);
  if (!slug) throw new InvalidProjectError(options.slug ?? options.title);

  const file = projectFilePath(home, slug);
  if (await pathExists(file)) throw new ProjectExistsError(slug);

  const data = { title: options.title.trim() || slug, status: options.status ?? 'active' };
  await writeFileAtomic(file, stringifyFrontmatter(data, options.content ?? ''));

  return (await findProject(home, slug))!;
}
