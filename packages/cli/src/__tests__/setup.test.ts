import fs from 'fs/promises';
import path from 'path';
import { promptDenyRule } from '@sabin/core';
import { setup, agentPaths } from '../commands/setup';
import { sandbox, Sandbox } from './helpers';

let box: Sandbox;
beforeEach(async () => {
  box = await sandbox();
  // Guard: never let setup reach the real home directory
  for (const target of Object.values(agentPaths())) {
    if (!target.startsWith(box.root + path.sep)) throw new Error(`Refusing to run setup: ${target} is outside the sandbox`);
  }
});
afterEach(async () => { await box.restore(); });

/** Every file under `dir` with its content, for before/after comparisons */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files[path.relative(dir, full)] = await fs.readFile(full, 'utf8');
    }
  }
  await walk(dir);
  return files;
}

async function readJson(file: string): Promise<any> {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

describe('sabin setup', () => {
  it('creates the home, installs the skill for both agents and denies prompt.md', async () => {
    await setup();
    const paths = agentPaths();

    expect(paths.claudeSkill).toBe(path.join(box.claudeDir, 'skills', 'sabin'));
    expect(paths.codexSkill).toBe(path.join(box.userHome, '.agents', 'skills', 'sabin'));
    await expect(fs.access(path.join(box.home, 'config.json'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(paths.claudeSkill, 'SKILL.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(paths.codexSkill, 'references'))).resolves.toBeUndefined();

    const settings = await readJson(path.join(box.claudeDir, 'settings.json'));
    expect(settings.permissions.deny).toEqual([promptDenyRule(box.home)]);

    const out = box.out();
    expect(out).toContain(`created   ${path.join(box.home, 'config.json')}`);
    expect(out).toContain(`created   ${paths.claudeSkill}  Claude Code`);
    expect(out).toContain(`created   ${paths.codexSkill}  Codex`);
    expect(out).toContain(`updated   ${path.join(box.claudeDir, 'settings.json')}`);
    expect(out).toContain('not installed. Run `sabin setup --hooks`');
    await expect(fs.access(path.join(box.codexHome, 'hooks.json'))).rejects.toThrow();
  });

  it('changes nothing on a second run and keeps settings that were already there', async () => {
    await fs.mkdir(box.claudeDir, { recursive: true });
    await fs.writeFile(path.join(box.claudeDir, 'settings.json'), JSON.stringify({
      model: 'opus',
      permissions: { deny: ['Read(./.env)'], allow: ['Bash(ls)'] },
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] }
    }));
    await fs.mkdir(box.codexHome, { recursive: true });
    await fs.writeFile(path.join(box.codexHome, 'hooks.json'), JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'notify' }] }] }
    }));

    await setup({ hooks: true });
    const first = { ...await snapshot(box.userHome), ...await snapshot(box.home) };
    box.clear();

    await setup({ hooks: true });
    const second = { ...await snapshot(box.userHome), ...await snapshot(box.home) };

    expect(second).toEqual(first);
    const out = box.out();
    expect(out).not.toMatch(/\b(created|updated|removed)\b/);
    expect(out).toContain('unchanged');

    const settings = await readJson(path.join(box.claudeDir, 'settings.json'));
    expect(settings.model).toBe('opus');
    expect(settings.permissions.deny).toEqual(['Read(./.env)', promptDenyRule(box.home)]);
    expect(settings.permissions.allow).toEqual(['Bash(ls)']);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe('say done');
    expect(settings.hooks.Stop[1].hooks[0].command).toBe('sabin agent-state');
    expect(Object.keys(settings.hooks).sort()).toEqual(
      ['Notification', 'PostToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit']
    );

    const codex = await readJson(path.join(box.codexHome, 'hooks.json'));
    expect(codex.hooks.Stop.map((group: any) => group.hooks[0].command)).toEqual(['notify', 'sabin agent-state']);
    expect(codex.hooks.PermissionRequest).toHaveLength(1);
  });

  it('says Codex needs the new hooks trusted', async () => {
    await setup({ hooks: true });
    expect(box.out()).toContain('/hooks');
    expect(box.out()).toContain(`updated   ${path.join(box.codexHome, 'hooks.json')}`);
  });

  it('removes what the old installer left behind, and only that', async () => {
    const commands = path.join(box.claudeDir, 'commands');
    await fs.mkdir(commands, { recursive: true });
    await fs.writeFile(path.join(commands, 'sabin-plan.md'), 'old');
    await fs.writeFile(path.join(commands, 'mine.md'), 'keep');
    const legacy = path.join(box.codexHome, 'skills', 'sabin');
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, 'SKILL.md'), '---\nname: sabin\n---\nold\n');
    const unrelated = path.join(box.codexHome, 'skills', 'other');
    await fs.mkdir(unrelated, { recursive: true });

    await setup();

    await expect(fs.access(path.join(commands, 'sabin-plan.md'))).rejects.toThrow();
    await expect(fs.access(path.join(commands, 'mine.md'))).resolves.toBeUndefined();
    await expect(fs.access(legacy)).rejects.toThrow();
    await expect(fs.access(unrelated)).resolves.toBeUndefined();
    expect(box.out()).toContain(`removed   ${legacy}  old Codex skill location`);
  });

  it('updates a skill copy that has drifted', async () => {
    await setup();
    const skill = path.join(box.claudeDir, 'skills', 'sabin');
    await fs.writeFile(path.join(skill, 'SKILL.md'), 'edited');
    await fs.writeFile(path.join(skill, 'stray.md'), 'stray');
    box.clear();

    await setup();
    expect(box.out()).toContain(`updated   ${skill}`);
    await expect(fs.access(path.join(skill, 'stray.md'))).rejects.toThrow();
  });

  it('leaves an unparsable settings file alone and exits non-zero', async () => {
    await fs.mkdir(box.claudeDir, { recursive: true });
    const file = path.join(box.claudeDir, 'settings.json');
    await fs.writeFile(file, '{ not json');

    await setup();

    expect(await fs.readFile(file, 'utf8')).toBe('{ not json');
    expect(box.out()).toContain(`failed    ${file}`);
    expect(process.exitCode).toBe(1);
  });
});
