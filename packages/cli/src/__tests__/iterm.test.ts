import { isITerm, labelTab, shellQuote } from '../iterm';

describe('iterm', () => {
  it('detects iTerm2 from TERM_PROGRAM', () => {
    expect(isITerm({ TERM_PROGRAM: 'iTerm.app' })).toBe(true);
    expect(isITerm({ TERM_PROGRAM: 'Apple_Terminal' })).toBe(false);
    expect(isITerm({})).toBe(false);
  });

  it('quotes for the shell, including embedded single quotes', () => {
    expect(shellQuote('plain')).toBe(`'plain'`);
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`);
  });

  describe('labelTab', () => {
    const originalTerm = process.env.TERM_PROGRAM;
    afterEach(() => {
      if (originalTerm === undefined) delete process.env.TERM_PROGRAM;
      else process.env.TERM_PROGRAM = originalTerm;
    });

    function fakeStream(isTTY: boolean) {
      const writes: string[] = [];
      return {
        stream: { isTTY, write: (text: string) => { writes.push(text); return true; } } as unknown as NodeJS.WriteStream,
        writes
      };
    }

    it('writes nothing when not attached to a terminal', () => {
      const { stream, writes } = fakeStream(false);
      labelTab('SABIN-0001-x', 'SABIN-0001', stream);
      expect(writes).toEqual([]);
    });

    it('sets the title everywhere and the badge only in iTerm2', () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const plain = fakeStream(true);
      labelTab('SABIN-0001-x', 'SABIN-0001', plain.stream);
      expect(plain.writes).toEqual(['\x1b]1;SABIN-0001-x\x07']);

      process.env.TERM_PROGRAM = 'iTerm.app';
      const iterm = fakeStream(true);
      labelTab('SABIN-0001-x', 'SABIN-0001', iterm.stream);
      expect(iterm.writes[1]).toBe(`\x1b]1337;SetBadgeFormat=${Buffer.from('SABIN-0001').toString('base64')}\x07`);
    });
  });
});
