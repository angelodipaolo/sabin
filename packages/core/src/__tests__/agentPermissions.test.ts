import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { denyPromptsAccess } from '../agentPermissions';

describe('denyPromptsAccess', () => {
  let projectRoot: string;
  let settingsPath: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-perm-'));
    settingsPath = path.join(projectRoot, '.claude', 'settings.local.json');
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  const read = async () => JSON.parse(await fs.readFile(settingsPath, 'utf8'));

  it('writes an absolute deny rule with the double-slash prefix', async () => {
    // A single leading slash anchors at the settings file, not the filesystem
    const result = await denyPromptsAccess(projectRoot, '/Users/angelo/notes/demo/.sabin/prompts');

    expect(result.added).toBe(true);
    expect((await read()).permissions.deny).toEqual([
      'Read(//Users/angelo/notes/demo/.sabin/prompts/**)'
    ]);
  });

  it('is idempotent', async () => {
    const promptsDir = '/Users/angelo/notes/demo/.sabin/prompts';
    await denyPromptsAccess(projectRoot, promptsDir);
    const second = await denyPromptsAccess(projectRoot, promptsDir);

    expect(second.added).toBe(false);
    expect((await read()).permissions.deny).toHaveLength(1);
  });

  it('preserves unrelated settings', async () => {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify({
      model: 'opus',
      permissions: { allow: ['Bash(npm run test:*)'], deny: ['Read(./.env)'] }
    }));

    await denyPromptsAccess(projectRoot, '/notes/.sabin/prompts');
    const settings = await read();

    expect(settings.model).toBe('opus');
    expect(settings.permissions.allow).toEqual(['Bash(npm run test:*)']);
    expect(settings.permissions.deny).toEqual([
      'Read(./.env)',
      'Read(//notes/.sabin/prompts/**)'
    ]);
  });

  it('refuses to clobber a settings file it cannot parse', async () => {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, '{ not valid json');

    const result = await denyPromptsAccess(projectRoot, '/notes/.sabin/prompts');

    expect(result.added).toBe(false);
    expect(await fs.readFile(settingsPath, 'utf8')).toBe('{ not valid json');
  });
});
