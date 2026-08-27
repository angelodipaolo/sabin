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
      labelTab('SABIN-0001-x', stream);
      expect(writes).toEqual([]);
    });

    it('sets the title and nothing else, iTerm2 included', () => {
      process.env.TERM_PROGRAM = 'Apple_Terminal';
      const plain = fakeStream(true);
      labelTab('SABIN-0001-x', plain.stream);
      expect(plain.writes).toEqual(['\x1b]1;SABIN-0001-x\x07']);

      // No badge: it painted the ticket over the output in letters the size
      // of the window, duplicating a label the tab already carries
      process.env.TERM_PROGRAM = 'iTerm.app';
      const iterm = fakeStream(true);
      labelTab('SABIN-0001-x', iterm.stream);
      expect(iterm.writes).toEqual(['\x1b]1;SABIN-0001-x\x07']);
      expect(iterm.writes.join('')).not.toContain('SetBadgeFormat');
    });
  });
});
