import fs from 'fs/promises';
import os from 'os';
import path from 'path';

/**
 * iTerm2 watches this directory and reloads profiles from it at runtime, so
 * writing a file here is the whole installation - no restart, no plist
 * surgery, and deleting the file removes the profile again.
 */
export function dynamicProfilesDir(home: string = os.homedir()): string {
  return path.join(home, 'Library', 'Application Support', 'iTerm2', 'DynamicProfiles');
}

export function jumpProfilePath(home?: string): string {
  return path.join(dynamicProfilesDir(home), 'sabin.json');
}

/** NSEvent modifier flags, which is what iTerm2 stores */
const MODIFIERS: Record<string, number> = {
  shift: 1 << 17,
  control: 1 << 18,
  ctrl: 1 << 18,
  option: 1 << 19,
  opt: 1 << 19,
  alt: 1 << 19,
  command: 1 << 20,
  cmd: 1 << 20
};

/** macOS virtual key codes for the keys worth binding a picker to */
const KEY_CODES: Record<string, number> = {
  a: 0, s: 1, d: 2, f: 3, h: 4, g: 5, z: 6, x: 7, c: 8, v: 9,
  b: 11, q: 12, w: 13, e: 14, r: 15, y: 16, t: 17,
  o: 31, u: 32, i: 34, p: 35, l: 37, j: 38, k: 40, n: 45, m: 46,
  '1': 18, '2': 19, '3': 20, '4': 21, '5': 23, '6': 22, '7': 26, '8': 28, '9': 25, '0': 29,
  space: 49, return: 36, tab: 48, escape: 53
};

export interface Hotkey {
  keyCode: number;
  modifiers: number;
  /** What the key produces with no modifiers - iTerm2 matches on this */
  characters: string;
}

export class InvalidHotkeyError extends Error {
  constructor(spec: string) {
    super(
      `"${spec}" is not a hotkey Sabin can bind.\n` +
      `Expected modifiers and a key, e.g. opt+space, ctrl+space, cmd+shift+j.\n` +
      `Keys: a-z, 0-9, space, return, tab, escape. ` +
      `Modifiers: cmd, ctrl, opt, shift.`
    );
    this.name = 'InvalidHotkeyError';
  }
}

/**
 * Parse "opt+space" into what iTerm2 stores.
 *
 * A hotkey with no modifier is refused: this one fires system-wide, and
 * binding a bare key would swallow it in every application on the machine.
 */
export function parseHotkey(spec: string): Hotkey {
  const parts = spec.toLowerCase().split('+').map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) throw new InvalidHotkeyError(spec);

  const key = parts[parts.length - 1];
  const keyCode = KEY_CODES[key];
  if (keyCode === undefined) throw new InvalidHotkeyError(spec);

  let modifiers = 0;
  for (const part of parts.slice(0, -1)) {
    const flag = MODIFIERS[part];
    if (flag === undefined) throw new InvalidHotkeyError(spec);
    modifiers |= flag;
  }
  if (modifiers === 0) throw new InvalidHotkeyError(spec);

  return { keyCode, modifiers, characters: key === 'space' ? ' ' : key };
}

export interface JumpProfileOptions {
  /** Command the window runs instead of a login shell */
  command: string;
  hotkey: Hotkey;
  home?: string;
}

/**
 * A dedicated hotkey window that runs the picker.
 *
 * This is how a terminal with no plugin API gets a global command palette:
 * the window answers a system-wide keystroke, floats above everything, runs
 * one command, and auto-hides the moment it loses focus - which is exactly
 * what happens when the picker focuses the session you chose. The picker is a
 * flash on the screen rather than a mode you have to leave.
 *
 * Key names are iTerm2's own, from `ITAddressBookMgr.h`.
 */
export async function writeJumpProfile(options: JumpProfileOptions): Promise<string> {
  const { command, hotkey, home } = options;
  const file = jumpProfilePath(home);

  const profile = {
    Profiles: [
      {
        Name: 'Sabin Jump',
        // Stable, so rewriting the file updates the profile rather than
        // adding a second one
        Guid: 'sabin-jump',

        'Custom Command': 'Yes',
        Command: command,

        'Has Hotkey': true,
        'HotKey Key Code': hotkey.keyCode,
        'HotKey Modifier Flags': hotkey.modifiers,
        'HotKey Characters': hotkey.characters,
        'HotKey Characters Ignoring Modifiers': hotkey.characters,
        'HotKey Window AutoHides': true,
        'HotKey Window Floats': true,
        'HotKey Window Animates': true,
        'HotKey Window Reopens On Activation': false,

        // Centred and title-less: a palette, not a terminal you work in
        'Window Type': 17,
        Columns: 100,
        Rows: 20
      }
    ]
  };

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(profile, null, 2) + '\n', 'utf8');
  return file;
}
