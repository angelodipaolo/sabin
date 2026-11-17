import { parseTaskId, isTaskId, compareTaskIds, taskIdFromBranch } from '../ids';
import { slugFromTitle, parseProjectSlug } from '../slug';

describe('parseTaskId', () => {
  it('uppercases and trims', () => {
    expect(parseTaskId(' arch-1234 ')).toBe('ARCH-1234');
    expect(parseTaskId('SABIN-0025')).toBe('SABIN-0025');
    expect(parseTaskId('A1B2-7')).toBe('A1B2-7');
  });

  it.each([
    '../x', '../SABIN-1', 'SABIN-1/../../etc', 'SABIN-1/x', '/SABIN-1', 'SABIN-1\0',
    '', 'SABIN', '-1', '1ABC-2', 'SABIN-', 'SABIN-1a', 'SA BIN-1', 'SABIN_1', 'SABIN--1', '.', '..'
  ])('rejects %j', input => {
    expect(parseTaskId(input)).toBeNull();
    expect(isTaskId(input)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(parseTaskId(undefined)).toBeNull();
    expect(parseTaskId(null)).toBeNull();
  });
});

describe('compareTaskIds', () => {
  it('orders numerically within a prefix, then by prefix', () => {
    const ids = ['SABIN-10', 'ARCH-3', 'SABIN-2', 'ARCH-0012'];
    expect(ids.sort(compareTaskIds)).toEqual(['ARCH-3', 'ARCH-0012', 'SABIN-2', 'SABIN-10']);
  });
});

describe('taskIdFromBranch', () => {
  const known = ['ARCH-12', 'ARCH-123', 'SABIN-0025'];

  it('finds a known ID anywhere in the branch, in any case', () => {
    expect(taskIdFromBranch('angelo/SABIN-0025-command-center', known)).toBe('SABIN-0025');
    expect(taskIdFromBranch('angelo/sabin-0025-command-center', known)).toBe('SABIN-0025');
    expect(taskIdFromBranch('SABIN-0025', known)).toBe('SABIN-0025');
  });

  it('keeps ARCH-12 and ARCH-123 apart', () => {
    expect(taskIdFromBranch('angelo/ARCH-123-thing', known)).toBe('ARCH-123');
    expect(taskIdFromBranch('angelo/ARCH-12-thing', known)).toBe('ARCH-12');
    expect(taskIdFromBranch('angelo/ARCH-123-thing', ['ARCH-12'])).toBeNull();
    expect(taskIdFromBranch('angelo/ARCH-12', ['ARCH-123'])).toBeNull();
  });

  it('is bounded on the left too', () => {
    expect(taskIdFromBranch('angelo/XARCH-12-thing', ['ARCH-12'])).toBeNull();
    expect(taskIdFromBranch('angelo/1ARCH-12', ['ARCH-12'])).toBeNull();
  });

  it('ignores IDs it was not given', () => {
    expect(taskIdFromBranch('angelo/JIRA-5-thing', known)).toBeNull();
    expect(taskIdFromBranch('main', known)).toBeNull();
    expect(taskIdFromBranch(null, known)).toBeNull();
  });

  it('takes the earliest when a branch names two', () => {
    expect(taskIdFromBranch('angelo/ARCH-12-port-of-SABIN-0025', known)).toBe('ARCH-12');
  });
});

describe('slugFromTitle', () => {
  it('drops stop words and caps at 32 on a word boundary', () => {
    expect(slugFromTitle('Command center for the agents')).toBe('command-center-agents');
    const slug = slugFromTitle('Rewrite the core package for a brand new data model please')!;
    expect(slug.length).toBeLessThanOrEqual(32);
    expect(slug).toBe('rewrite-core-package-brand-new');
  });

  it('keeps stop words when nothing else is left', () => {
    expect(slugFromTitle('To be or not')).toBe('not');
    expect(slugFromTitle('of the')).toBe('of-the');
  });

  it('returns null for an empty title', () => {
    expect(slugFromTitle('!!!')).toBeNull();
  });

  it('cuts a single oversized word', () => {
    expect(slugFromTitle('a'.repeat(40))).toHaveLength(32);
  });
});

describe('parseProjectSlug', () => {
  it('normalises to a safe slug', () => {
    expect(parseProjectSlug('Sabin App')).toBe('sabin-app');
    expect(parseProjectSlug('../etc')).toBe('etc');
    expect(parseProjectSlug('  ')).toBeNull();
  });
});
