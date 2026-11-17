import fs from 'fs/promises';
import path from 'path';
import { listProjects, createProject, findProject } from '../projects';
import { createTask, setTaskStatus } from '../tasks';
import { defaultConfig } from '../config';
import { tempDir } from './helpers';

const config = defaultConfig();
let home: string;

beforeEach(async () => {
  home = await tempDir('sabin-projects-');
});

afterEach(async () => {
  await fs.rm(home, { recursive: true, force: true });
});

describe('projects', () => {
  it('derives projects from files and from tasks, with counts', async () => {
    await createProject(home, { title: 'Command Center', status: 'paused', content: 'Prose\n' });
    await createProject(home, { title: 'Empty' });
    await createTask(home, config, { title: 'A', project: 'command-center' });
    const b = await createTask(home, config, { title: 'B', project: 'command-center' });
    await setTaskStatus(home, b.id, 'review');
    await createTask(home, config, { title: 'C', project: 'Implied Only' });
    await createTask(home, config, { title: 'D' });

    const projects = await listProjects(home);
    expect(projects.map(project => project.slug)).toEqual(['command-center', 'empty', 'implied-only']);

    const [center, empty, implied] = projects;
    expect(center).toMatchObject({ title: 'Command Center', status: 'paused', total: 2 });
    expect(center.file).toBe(path.join(home, 'projects', 'command-center.md'));
    expect(center.content.trim()).toBe('Prose');
    expect(center.counts).toEqual({ open: 1, ready: 0, in_progress: 0, review: 1, completed: 0 });
    expect(empty.total).toBe(0);
    expect(implied).toMatchObject({ title: 'implied-only', status: 'active', file: null, total: 1 });
  });

  it('finds one project, file-backed or implied', async () => {
    await createTask(home, config, { title: 'A', project: 'core' });
    expect((await findProject(home, 'Core'))?.total).toBe(1);
    expect(await findProject(home, 'nope')).toBeNull();
  });

  it('refuses to create a project file twice', async () => {
    await createProject(home, { title: 'Core' });
    await expect(createProject(home, { title: 'core' })).rejects.toMatchObject({ code: 'PROJECT_EXISTS' });
  });

  it('keeps a project whose file is broken', async () => {
    await fs.mkdir(path.join(home, 'projects'), { recursive: true });
    await fs.writeFile(path.join(home, 'projects', 'broken.md'), '---\ntitle: [x\n---\n');
    expect((await listProjects(home)).map(project => project.slug)).toEqual(['broken']);
  });
});
