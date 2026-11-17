import fs from 'fs/promises';
import path from 'path';
import {
  promptDenyRule,
  mergeClaudePromptDeny,
  mergeClaudeActivityHooks,
  mergeCodexActivityHooks,
  CLAUDE_HOOK_EVENTS,
  CODEX_HOOK_EVENTS,
  AGENT_STATE_COMMAND
} from '../agentIntegration';
import { tempDir } from './helpers';

let dir: string;
const home = '/Users/someone/sabin';

beforeEach(async () => {
  dir = await tempDir('sabin-integration-');
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const read = async (file: string) => JSON.parse(await fs.readFile(file, 'utf8'));

describe('prompt deny rule', () => {
  it('anchors at the filesystem root', () => {
    expect(promptDenyRule(home)).toBe('Read(//Users/someone/sabin/tasks/**/prompt.md)');
  });

  it('creates the file when missing, and is idempotent', async () => {
    const file = path.join(dir, '.claude', 'settings.json');
    expect(await mergeClaudePromptDeny(file, home)).toEqual({ path: file, changed: true, added: [promptDenyRule(home)] });
    expect(await mergeClaudePromptDeny(file, home)).toEqual({ path: file, changed: false, added: [] });
    expect((await read(file)).permissions.deny).toEqual([promptDenyRule(home)]);
  });

  it('keeps everything already there', async () => {
    const file = path.join(dir, 'settings.json');
    const existing = { model: 'opus', permissions: { allow: ['Bash(ls)'], deny: ['Read(./.env)'] }, hooks: { Stop: [] } };
    await fs.writeFile(file, JSON.stringify(existing));

    await mergeClaudePromptDeny(file, home);

    expect(await read(file)).toEqual({ ...existing, permissions: { allow: ['Bash(ls)'], deny: ['Read(./.env)', promptDenyRule(home)] } });
  });

  it('refuses to touch a file it cannot parse', async () => {
    const file = path.join(dir, 'settings.json');
    await fs.writeFile(file, '{ "model": "opus", }');
    await expect(mergeClaudePromptDeny(file, home)).rejects.toMatchObject({ code: 'UNPARSABLE_FILE' });
    expect(await fs.readFile(file, 'utf8')).toBe('{ "model": "opus", }');
  });
});

describe('activity hooks', () => {
  it('merges Claude hooks beside existing ones, once', async () => {
    const file = path.join(dir, 'settings.json');
    const theirs = { matcher: 'Bash', hooks: [{ type: 'command', command: 'their-linter' }] };
    await fs.writeFile(file, JSON.stringify({ permissions: { deny: ['x'] }, hooks: { PostToolUse: [theirs], PreToolUse: [theirs] } }));

    const first = await mergeClaudeActivityHooks(file);
    expect(first.added).toEqual([...CLAUDE_HOOK_EVENTS]);
    expect(await mergeClaudeActivityHooks(file)).toMatchObject({ changed: false, added: [] });

    const settings = await read(file);
    expect(settings.permissions).toEqual({ deny: ['x'] });
    expect(settings.hooks.PreToolUse).toEqual([theirs]);
    expect(settings.hooks.PostToolUse).toEqual([theirs, { hooks: [{ type: 'command', command: AGENT_STATE_COMMAND }] }]);
    expect(Object.keys(settings.hooks).sort()).toEqual([...CLAUDE_HOOK_EVENTS, 'PreToolUse'].sort());
    expect(settings.hooks.Notification).toEqual([{ hooks: [{ type: 'command', command: 'sabin agent-state' }] }]);
  });

  it('merges Codex hooks into hooks.json, keeping what is there', async () => {
    const file = path.join(dir, '.codex', 'hooks.json');
    await fs.mkdir(path.dirname(file));
    const theirs = { hooks: [{ type: 'command', command: 'notify-me' }] };
    await fs.writeFile(file, JSON.stringify({ hooks: { Stop: [theirs] } }));

    expect((await mergeCodexActivityHooks(file)).added).toEqual([...CODEX_HOOK_EVENTS]);
    expect((await mergeCodexActivityHooks(file)).changed).toBe(false);

    const hooks = (await read(file)).hooks;
    expect(hooks.Stop).toEqual([theirs, { hooks: [{ type: 'command', command: 'sabin agent-state' }] }]);
    expect(hooks.PermissionRequest).toHaveLength(1);
    expect(hooks.Notification).toBeUndefined();
  });

  it('adds only the events that are missing', async () => {
    const file = path.join(dir, 'hooks.json');
    await fs.writeFile(file, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'sabin agent-state' }] }] } }));
    expect((await mergeCodexActivityHooks(file)).added).not.toContain('Stop');
  });
});
