import { noteFilename, noteTargetName, validateNoteName, seedFor } from '../services/noteFiles';

describe('noteFilename', () => {
  it('defaults a bare name to markdown', () => {
    expect(noteFilename('research')).toBe('research.md');
  });

  it('never overrides an extension the user chose', () => {
    expect(noteFilename('schema.json')).toBe('schema.json');
    expect(noteFilename('config.yaml')).toBe('config.yaml');
    expect(noteFilename('rows.csv')).toBe('rows.csv');
    expect(noteFilename('server.log')).toBe('server.log');
  });

  it('trims surrounding whitespace', () => {
    expect(noteFilename('  plan.md  ')).toBe('plan.md');
  });

  it('leaves a dotted name alone rather than doubling the extension', () => {
    expect(noteFilename('api.v2.json')).toBe('api.v2.json');
  });
});

describe('noteTargetName', () => {
  it('gives a file the default extension', () => {
    expect(noteTargetName('research', false)).toBe('research.md');
  });

  it('leaves a directory alone - a folder is not a markdown file', () => {
    expect(noteTargetName('transcripts', true)).toBe('transcripts');
  });
});

describe('validateNoteName', () => {
  it('accepts an ordinary name', () => {
    expect(validateNoteName('research')).toBeUndefined();
    expect(validateNoteName('schema.json')).toBeUndefined();
  });

  it('refuses an empty name', () => {
    expect(validateNoteName('')).toBe('Give the note a name');
    expect(validateNoteName('   ')).toBe('Give the note a name');
  });

  it('refuses a path separator - notes live in one directory', () => {
    expect(validateNoteName('sub/note.md')).toBe('Notes cannot contain a path separator');
    expect(validateNoteName('sub\\note.md')).toBe('Notes cannot contain a path separator');
  });

  it('refuses the directory entries', () => {
    expect(validateNoteName('.')).toBe('That is not a name');
    expect(validateNoteName('..')).toBe('That is not a name');
  });

  it('refuses a collision, comparing the name the note would land under', () => {
    expect(validateNoteName('plan', ['plan.md'])).toBe('A file named plan.md already exists');
  });

  it('treats a collision case-insensitively, as the filesystem does', () => {
    expect(validateNoteName('Plan.md', ['plan.md'])).toBe('A file named Plan.md already exists');
  });

  it('compares a directory rename against the raw name', () => {
    expect(validateNoteName('logs', ['logs'], true)).toBe('A file named logs already exists');
    expect(validateNoteName('logs', ['logs.md'], true)).toBeUndefined();
  });
});

describe('seedFor', () => {
  it('gives markdown a heading', () => {
    expect(seedFor('research.md')).toBe('# research\n\n');
  });

  it('gives JSON a valid empty document', () => {
    expect(seedFor('schema.json')).toBe('{}\n');
  });

  it('leaves other formats empty rather than guessing their syntax', () => {
    expect(seedFor('config.yaml')).toBe('');
    expect(seedFor('rows.csv')).toBe('');
    expect(seedFor('server.log')).toBe('');
    expect(seedFor('no-extension')).toBe('');
  });

  it('is case insensitive about extensions', () => {
    expect(seedFor('README.MD')).toBe('# README\n\n');
  });
});
