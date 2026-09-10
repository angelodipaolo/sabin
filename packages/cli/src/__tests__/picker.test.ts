import { filterRows, moveSelection, PickerRow } from '../picker';

function row(title: string, search = title): PickerRow<string> {
  return { value: title, title, detail: '', search };
}

const rows = [
  row('SABIN-0017 claude', 'SABIN-0017 claude implement'),
  row('SABIN-0017 zsh', 'SABIN-0017 zsh'),
  row('SABIN-0019 codex', 'SABIN-0019 codex review'),
  row('SABIN-0201 claude', 'SABIN-0201 claude')
];

describe('filterRows', () => {
  it('keeps everything for an empty query', () => {
    expect(filterRows(rows, '')).toHaveLength(4);
  });

  it('matches a substring of the ticket', () => {
    expect(filterRows(rows, '0019').map(r => r.value)).toEqual(['SABIN-0019 codex']);
  });

  it('does not match a ticket that merely contains the digits elsewhere', () => {
    // "17" must not also bring up SABIN-0201
    expect(filterRows(rows, '0017').map(r => r.value)).toEqual([
      'SABIN-0017 claude',
      'SABIN-0017 zsh'
    ]);
  });

  it('requires every term, in any order', () => {
    expect(filterRows(rows, 'claude 0017').map(r => r.value)).toEqual(['SABIN-0017 claude']);
  });

  it('matches the step as well as the ticket', () => {
    expect(filterRows(rows, 'review').map(r => r.value)).toEqual(['SABIN-0019 codex']);
  });

  it('ignores case', () => {
    expect(filterRows(rows, 'CLAUDE').map(r => r.value)).toHaveLength(2);
  });

  it('returns nothing when nothing matches', () => {
    expect(filterRows(rows, 'nope')).toEqual([]);
  });
});

describe('moveSelection', () => {
  it('moves within the list', () => {
    expect(moveSelection(1, 1, 4)).toBe(2);
    expect(moveSelection(1, -1, 4)).toBe(0);
  });

  it('stops at the ends rather than wrapping', () => {
    expect(moveSelection(0, -1, 4)).toBe(0);
    expect(moveSelection(3, 1, 4)).toBe(3);
  });

  it('pulls a stale index back into range when the filter shrinks the list', () => {
    expect(moveSelection(7, 0, 2)).toBe(1);
  });

  it('is zero for an empty list', () => {
    expect(moveSelection(3, 1, 0)).toBe(0);
  });
});
