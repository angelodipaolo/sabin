import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyScore } from '../src/shared/fuzzy';

describe('fuzzyScore', () => {
  it('matches subsequences and rejects non-matches', () => {
    expect(fuzzyScore('cmc', 'Command center')).not.toBeNull();
    expect(fuzzyScore('xyz', 'Command center')).toBeNull();
    expect(fuzzyScore('', 'anything')).toBe(0);
  });
  it('ranks substrings above scattered matches and word starts above middles', () => {
    expect(fuzzyScore('center', 'Command center')!).toBeGreaterThan(fuzzyScore('cntr', 'Command center')!);
    expect(fuzzyScore('cc', 'Command center')!).toBeGreaterThan(fuzzyScore('cc', 'Rocket music')!);
  });
});

describe('fuzzyFilter', () => {
  const tasks = [
    { id: 'SABIN-0001', title: 'Command center app', project: 'cc', status: 'In progress' },
    { id: 'ARCH-1234', title: 'Rate limiter', project: '', status: 'Review' },
    { id: 'SABIN-0007', title: 'Fix anchor links', project: 'docs-site', status: 'Completed' }
  ];
  const fields = (task: typeof tasks[number]) => [task.id, task.title, task.project, task.status];

  it('requires every word to match some field', () => {
    expect(fuzzyFilter(tasks, 'docs compl', fields).map(r => r.item.id)).toEqual(['SABIN-0007']);
    expect(fuzzyFilter(tasks, 'arch rev', fields).map(r => r.item.id)).toEqual(['ARCH-1234']);
  });
  it('matches IDs case-insensitively and keeps order for an empty query', () => {
    expect(fuzzyFilter(tasks, 'sabin-0001', fields)[0].item.id).toBe('SABIN-0001');
    expect(fuzzyFilter(tasks, '  ', fields).map(r => r.item.id)).toEqual(tasks.map(t => t.id));
  });
});
