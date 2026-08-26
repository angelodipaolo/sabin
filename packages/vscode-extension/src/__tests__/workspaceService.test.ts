import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { WorkspaceService } from '../services/workspaceService';

jest.mock('vscode');

/**
 * Runs against a real Sabin directory on disk - the service is a thin layer
 * over core, and what matters is that the extension sees exactly what the
 * CLI writes.
 */
describe('WorkspaceService', () => {
  let root: string;
  let sabinDir: string;
  let projectRoot: string;
  let service: WorkspaceService;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-ext-'));
    sabinDir = path.join(root, 'notes', '.sabin');
    projectRoot = path.join(root, 'repo');
    await fs.mkdir(sabinDir, { recursive: true });
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.writeFile(path.join(sabinDir, 'config.json'), JSON.stringify({ projectPrefix: 'SABIN', taskNumberPadding: 4 }));
    await fs.writeFile(path.join(projectRoot, '.sabin'), JSON.stringify({ sabinDir: path.relative(projectRoot, sabinDir) }));

    service = new WorkspaceService(projectRoot);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('resolves the Sabin directory through the link file', async () => {
    expect(await service.getSabinDir()).toBe(sabinDir);
  });

  it('creates a task with its notes directory and scratchpad', async () => {
    const created = await service.createTask('Update telemetry');

    expect(created.ticket).toBe('SABIN-0001');
    expect(created.name).toBe('SABIN-0001-update-telemetry');
    expect(created.taskFile).toBe(path.join(sabinDir, 'tasks', 'open', 'SABIN-0001.md'));
    expect((await fs.stat(created.notesDir)).isDirectory()).toBe(true);
    expect((await fs.stat(created.promptFile)).isFile()).toBe(true);
  });

  it('honours an explicit ID and suggests the next one', async () => {
    await service.createTask('External', 'JIRA-42');
    expect(await service.nextTaskId()).toBe('SABIN-0001');
    await service.createTask('Own');
    expect(await service.nextTaskId()).toBe('SABIN-0002');
  });

  it('lists workspaces with their plan when one exists', async () => {
    const created = await service.createTask('Planned');
    await fs.writeFile(path.join(created.notesDir, 'plan.md'), '# Plan');

    const [listed] = await service.listWorkspaces();
    expect(listed.ticket).toBe('SABIN-0001');
    expect(listed.status).toBe('open');
    expect(listed.planPath).toBe(path.join(created.notesDir, 'plan.md'));
  });

  it('changes status by moving the file, like the CLI', async () => {
    await service.createTask('Move');
    await service.setStatus('SABIN-0001', 'completed');

    const found = await service.find('SABIN-0001');
    expect(found?.status).toBe('completed');
    expect(found?.taskFile).toBe(path.join(sabinDir, 'tasks', 'completed', 'SABIN-0001.md'));
  });

  it('deletes the task file but keeps the notes', async () => {
    const created = await service.createTask('Drop');
    await service.deleteTask('SABIN-0001');

    expect(await service.find('SABIN-0001')).toBeUndefined();
    expect((await fs.stat(created.notesDir)).isDirectory()).toBe(true);
  });

  it('skips malformed task files rather than failing the list', async () => {
    await service.createTask('Good');
    await fs.writeFile(path.join(sabinDir, 'tasks', 'open', 'BAD-1.md'), '---\nstatus: [\n---\n');

    const tickets = (await service.listWorkspaces()).map(w => w.ticket);
    expect(tickets).toEqual(['SABIN-0001']);
  });
});
