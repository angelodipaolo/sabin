import { describe, expect, it } from 'vitest';
import { duration, relativeTime } from '../src/shared/time';

const now = new Date('2026-11-16T12:00:00Z');
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe('relativeTime', () => {
  it('is compact', () => {
    expect(relativeTime(ago(10_000), now)).toBe('now');
    expect(relativeTime(ago(12 * 60_000), now)).toBe('12m');
    expect(relativeTime(ago(3 * 3600_000 + 59 * 60_000), now)).toBe('3h');
    expect(relativeTime(ago(2 * 86400_000), now)).toBe('2d');
  });
  it('falls back to a date after a week, with the year when it differs', () => {
    expect(relativeTime('2026-11-01T12:00:00Z', now)).toBe('Nov 1');
    expect(relativeTime('2025-03-04T12:00:00Z', now)).toBe('Mar 4, 2025');
  });
  it('treats the future as now and garbage as empty', () => {
    expect(relativeTime(ago(-60_000), now)).toBe('now');
    expect(relativeTime('nope', now)).toBe('');
    expect(relativeTime(undefined, now)).toBe('');
  });
});

describe('duration', () => {
  it('shows seconds, minutes, hours with minutes, days with hours', () => {
    expect(duration(ago(40_000), now)).toBe('40s');
    expect(duration(ago(14 * 60_000), now)).toBe('14m');
    expect(duration(ago(65 * 60_000), now)).toBe('1h 05m');
    expect(duration(ago(51 * 3600_000), now)).toBe('2d 3h');
  });
});
