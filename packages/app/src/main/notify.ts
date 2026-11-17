import { app, Notification } from 'electron';
import { needsYouCount } from '../shared/attention';
import { diffNotices } from '../shared/notices';
import type { Snapshot } from '../shared/types';
import { testHooks } from './testHooks';

/**
 * Notifications and the dock badge, driven by consecutive snapshots. With
 * SABIN_APP_NO_NOTIFY=1 notices are recorded for the tests instead of shown.
 */
export class Notifier {
  private previous: Snapshot | null = null;
  private readonly seen = new Set<string>();

  constructor(private readonly openTask: (taskId: string | null) => void) {}

  update(next: Snapshot): void {
    for (const notice of diffNotices(this.previous, next)) {
      if (this.seen.has(notice.key)) continue;
      this.seen.add(notice.key);
      if (process.env.SABIN_APP_NO_NOTIFY === '1') {
        testHooks().notifications.push({ title: notice.title, body: notice.body, taskId: notice.taskId });
        continue;
      }
      if (!Notification.isSupported()) continue;
      const shown = new Notification({ title: notice.title, body: notice.body, silent: notice.kind === 'review' });
      shown.on('click', () => this.openTask(notice.taskId));
      shown.show();
    }
    this.previous = next;

    const count = next.homeExists ? needsYouCount(next.tasks, next.unassigned) : 0;
    if (process.platform === 'darwin') app.dock?.setBadge(count > 0 ? String(count) : '');
  }
}
