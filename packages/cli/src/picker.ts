import chalk from 'chalk';

export interface PickerRow<T> {
  value: T;
  /** Left column - what the row is */
  title: string;
  /** Right column - detail, dimmed */
  detail: string;
  /** Everything typing should match against */
  search: string;
  /** Rows that cannot be jumped to, shown last and dimmed */
  inactive?: boolean;
}

/**
 * Rows matching every whitespace-separated term, in order of nothing - the
 * input order is the ranking, because it is already meaningful (agents above
 * shells, live above dead).
 *
 * Substring rather than fuzzy: a ticket list is short and typing "17" should
 * not also match SABIN-0201.
 */
export function filterRows<T>(rows: PickerRow<T>[], query: string): PickerRow<T>[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return rows;

  return rows.filter(row => {
    const haystack = row.search.toLowerCase();
    return terms.every(term => haystack.includes(term));
  });
}

/** Where the selection lands after a move, clamped rather than wrapped */
export function moveSelection(index: number, delta: number, length: number): number {
  if (length === 0) return 0;
  return Math.min(Math.max(index + delta, 0), length - 1);
}

export interface PickerOptions {
  title: string;
  /** Shown when the filter matches nothing */
  empty?: string;
}

/**
 * A full-screen list you type to filter and press Enter to choose.
 *
 * Written by hand rather than pulled in: it has to run inside a dedicated
 * hotkey window with no shell around it, where an `fzf` that happens not to
 * be installed is a black window and no explanation. Alternate screen buffer,
 * so whatever was on the terminal is still there afterwards.
 */
export function pick<T>(
  rows: PickerRow<T>[],
  options: PickerOptions,
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout
): Promise<T | null> {
  if (!input.isTTY || !output.isTTY) {
    return Promise.reject(new Error('The picker needs a terminal.'));
  }

  return new Promise<T | null>(resolve => {
    let query = '';
    let index = 0;
    let visible = rows;

    const wasRaw = input.isRaw;
    output.write('\x1b[?1049h'); // alternate screen
    output.write('\x1b[?25l');   // hide cursor
    input.setRawMode(true);
    input.resume();
    input.setEncoding('utf8');

    const finish = (value: T | null) => {
      input.setRawMode(wasRaw ?? false);
      input.pause();
      input.off('data', onData);
      output.write('\x1b[?25h');
      output.write('\x1b[?1049l'); // restore whatever was on screen
      resolve(value);
    };

    const render = () => {
      visible = filterRows(rows, query);
      index = moveSelection(index, 0, visible.length);

      const lines: string[] = [
        chalk.bold(options.title),
        '',
        `  ${chalk.cyan('❯')} ${query}${chalk.gray('▏')}`,
        ''
      ];

      if (visible.length === 0) {
        lines.push(chalk.gray(`  ${options.empty ?? 'Nothing matches'}`));
      }

      const width = Math.max(0, ...visible.map(row => row.title.length));
      visible.forEach((row, i) => {
        const selected = i === index;
        const title = row.title.padEnd(width);
        const text = `${title}  ${chalk.gray(row.detail)}`;
        const dimmed = row.inactive ? chalk.gray(title) + `  ${chalk.gray(row.detail)}` : text;
        lines.push(selected ? `${chalk.cyan('▸')} ${dimmed}` : `  ${dimmed}`);
      });

      lines.push('', chalk.gray('  ↑↓ move   ⏎ jump   esc close'));

      output.write('\x1b[H\x1b[2J' + lines.join('\r\n'));
    };

    const onData = (data: string) => {
      // Arrows arrive as escape sequences, so a bare ESC is only a cancel
      // when nothing follows it
      if (data === '\x1b[A' || data === '\x10') index = moveSelection(index, -1, visible.length);
      else if (data === '\x1b[B' || data === '\x0e') index = moveSelection(index, 1, visible.length);
      else if (data === '\r' || data === '\n') return finish(visible[index]?.value ?? null);
      else if (data === '\x1b' || data === '\x03' || data === '\x04') return finish(null);
      else if (data === '\x7f' || data === '\b') query = query.slice(0, -1);
      else if (data === '\x15') query = '';
      else if (data >= ' ' && !data.startsWith('\x1b')) query += data;
      else return;

      render();
    };

    input.on('data', onData);
    render();
  });
}
