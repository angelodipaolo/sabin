import { noteFilename, seedFor } from '../services/noteFiles';

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
