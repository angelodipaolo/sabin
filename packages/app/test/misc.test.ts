import { describe, expect, it } from 'vitest';
import { taskFromArgv } from '../src/main/args';
import { extractMarkedPath, mergePath } from '../src/main/shellEnv';
import { delayFor, DEFAULT_DELAY_MS, STATE_DELAY_MS } from '../src/main/watcher';
import { plainText } from '../src/shared/text';

describe('taskFromArgv', () => {
  it('reads --task in both forms and uppercases', () => {
    expect(taskFromArgv(['electron', '.', '--task', 'sabin-25'])).toBe('SABIN-25');
    expect(taskFromArgv(['app', '--task=ARCH-1'])).toBe('ARCH-1');
  });
  it('ignores anything that is not an ID', () => {
    expect(taskFromArgv(['app', '--task', '../etc'])).toBeNull();
    expect(taskFromArgv(['app'])).toBeNull();
  });
});

describe('shell PATH', () => {
  it('extracts the marked PATH from noisy output', () => {
    expect(extractMarkedPath('Welcome!\n__SABIN_PATH__/opt/homebrew/bin:/usr/bin__SABIN_PATH__')).toBe('/opt/homebrew/bin:/usr/bin');
    expect(extractMarkedPath('no markers')).toBeNull();
  });
  it('merges shell entries first without duplicates', () => {
    expect(mergePath('/a:/b', '/b:/c')).toBe('/a:/b:/c');
    expect(mergePath(null, '/usr/bin')).toBe('/usr/bin');
  });
});

describe('watcher delays', () => {
  it('waits longer for state/ and ignores lock and temp files', () => {
    expect(delayFor('tasks/T-1/plan.md')).toBe(DEFAULT_DELAY_MS);
    expect(delayFor('state/sessions/a.json')).toBe(STATE_DELAY_MS);
    expect(delayFor('.lock')).toBeNull();
    expect(delayFor('tasks/T-1/task.md.123.abc.tmp')).toBeNull();
  });
});

describe('plainText', () => {
  it('strips markdown to one line', () => {
    expect(plainText('**Done.** Ran `npm test`.\n\n- 14 pass\n- [link](http://x)')).toBe('Done. Ran npm test. 14 pass link');
    expect(plainText('# Heading\n> quote')).toBe('Heading quote');
  });
});
