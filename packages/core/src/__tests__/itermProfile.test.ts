import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { parseHotkey, writeJumpProfile, jumpProfilePath, InvalidHotkeyError } from '../itermProfile';

describe('parseHotkey', () => {
  it('reads a modifier and a key', () => {
    expect(parseHotkey('opt+space')).toEqual({ keyCode: 49, modifiers: 1 << 19, characters: ' ' });
  });

  it('accepts the long modifier names', () => {
    expect(parseHotkey('option+space').modifiers).toBe(parseHotkey('opt+space').modifiers);
    expect(parseHotkey('control+j').modifiers).toBe(parseHotkey('ctrl+j').modifiers);
  });

  it('combines modifiers', () => {
    expect(parseHotkey('cmd+shift+j').modifiers).toBe((1 << 20) | (1 << 17));
  });

  it('ignores case and spacing', () => {
    expect(parseHotkey('CMD + J')).toEqual(parseHotkey('cmd+j'));
  });

  it('refuses a key with no modifier - it would be swallowed everywhere', () => {
    expect(() => parseHotkey('space')).toThrow(InvalidHotkeyError);
    expect(() => parseHotkey('+space')).toThrow(InvalidHotkeyError);
  });

  it('refuses a key it cannot name', () => {
    expect(() => parseHotkey('cmd+f13')).toThrow(InvalidHotkeyError);
  });

  it('refuses a modifier it cannot name', () => {
    expect(() => parseHotkey('hyper+space')).toThrow(InvalidHotkeyError);
  });
});

describe('writeJumpProfile', () => {
  let home: string;

  beforeEach(async () => {
    home = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-profile-'));
  });

  afterEach(async () => {
    await fs.rm(home, { recursive: true, force: true });
  });

  async function write() {
    return writeJumpProfile({ command: '/usr/local/bin/sabin jump --picker', hotkey: parseHotkey('opt+space'), home });
  }

  it('writes a dynamic profile iTerm2 will load', async () => {
    const file = await write();
    const [profile] = JSON.parse(await fs.readFile(file, 'utf8')).Profiles;

    expect(file).toBe(jumpProfilePath(home));
    expect(profile.Name).toBe('Sabin Jump');
    expect(profile['Custom Command']).toBe('Yes');
    expect(profile.Command).toBe('/usr/local/bin/sabin jump --picker');
  });

  it('binds the hotkey as iTerm2 stores it', async () => {
    const [profile] = JSON.parse(await fs.readFile(await write(), 'utf8')).Profiles;

    expect(profile['Has Hotkey']).toBe(true);
    expect(profile['HotKey Key Code']).toBe(49);
    expect(profile['HotKey Modifier Flags']).toBe(1 << 19);
    // Non-empty is what tells iTerm2 a hotkey is assigned
    expect(profile['HotKey Characters Ignoring Modifiers']).toBe(' ');
  });

  it('makes a window that gets out of the way on its own', async () => {
    const [profile] = JSON.parse(await fs.readFile(await write(), 'utf8')).Profiles;

    expect(profile['HotKey Window AutoHides']).toBe(true);
    expect(profile['HotKey Window Floats']).toBe(true);
  });

  it('keeps one profile however many times it is installed', async () => {
    await write();
    const second = await write();
    const parsed = JSON.parse(await fs.readFile(second, 'utf8'));

    expect(parsed.Profiles).toHaveLength(1);
    expect(parsed.Profiles[0].Guid).toBe('sabin-jump');
  });

  it('creates the DynamicProfiles directory when iTerm2 never has', async () => {
    await fs.rm(path.join(home, 'Library'), { recursive: true, force: true });

    await expect(write()).resolves.toContain('DynamicProfiles');
  });
});
