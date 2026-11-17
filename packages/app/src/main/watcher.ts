import fs from 'fs';
import path from 'path';

/** Agent activity changes several times a turn, on every agent at once */
export const STATE_DELAY_MS = 700;
export const DEFAULT_DELAY_MS = 120;

/** Whether a change under the home is worth a snapshot, and how soon */
export function delayFor(relative: string | null): number | null {
  if (!relative) return DEFAULT_DELAY_MS;
  const normalised = relative.split(path.sep).join('/');
  // The lock directory and atomic-write temp files are noise around the real write
  if (normalised === '.lock' || normalised.startsWith('.lock/')) return null;
  if (normalised.endsWith('.tmp')) return null;
  if (path.basename(normalised) === '.DS_Store') return null;
  return normalised.startsWith('state/') ? STATE_DELAY_MS : DEFAULT_DELAY_MS;
}

/**
 * One recursive watcher over the home. Fires `onChange` at most once per
 * delay window: the first event schedules it, later ones can only bring it
 * sooner. Never pushed back, so a constantly busy agent cannot starve the UI.
 */
export function watchHome(home: string, onChange: () => void): () => void {
  let timer: NodeJS.Timeout | null = null;
  let due = Infinity;

  const schedule = (delay: number) => {
    const at = Date.now() + delay;
    if (timer && due <= at) return;
    if (timer) clearTimeout(timer);
    due = at;
    timer = setTimeout(() => {
      timer = null;
      due = Infinity;
      onChange();
    }, delay);
  };

  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(home, { recursive: true }, (_event, filename) => {
      const delay = delayFor(filename ? filename.toString() : null);
      if (delay !== null) schedule(delay);
    });
  } catch {
    return () => undefined;
  }
  watcher.on('error', () => undefined);

  return () => {
    if (timer) clearTimeout(timer);
    watcher.close();
  };
}
