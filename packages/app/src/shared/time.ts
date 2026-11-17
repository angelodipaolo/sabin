const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parse(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : null;
}

/**
 * Compact "how long ago": `now`, `12m`, `3h`, `2d`, then a date. Short on
 * purpose - it sits in a badge next to an activity word. A time in the
 * future (clock skew between machines) reads as now.
 */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  const time = parse(iso);
  if (time === null) return '';
  const elapsed = now.getTime() - time;
  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;
  const date = new Date(time);
  const label = `${MONTHS[date.getMonth()]} ${date.getDate()}`;
  return date.getFullYear() === now.getFullYear() ? label : `${label}, ${date.getFullYear()}`;
}

/**
 * How long something has lasted: `40s`, `12m`, `1h 05m`, `2d 3h`. Used for
 * waits, where the difference between one minute and fifty is the point.
 */
export function duration(fromIso: string | null | undefined, now: Date = new Date()): string {
  const time = parse(fromIso);
  if (time === null) return '';
  const elapsed = Math.max(0, now.getTime() - time);
  if (elapsed < MINUTE) return `${Math.floor(elapsed / 1000)}s`;
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) {
    const minutes = Math.floor((elapsed % HOUR) / MINUTE);
    return `${Math.floor(elapsed / HOUR)}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${Math.floor(elapsed / DAY)}d ${Math.floor((elapsed % DAY) / HOUR)}h`;
}

/** A full local timestamp for tooltips */
export function absoluteTime(iso: string | null | undefined): string {
  const time = parse(iso);
  return time === null ? '' : new Date(time).toLocaleString();
}
