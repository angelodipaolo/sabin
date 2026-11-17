import type { Snapshot, TaskStatus } from '../shared/types';

/** Keep confirmed status writes ahead of snapshots still waiting on Git. */
export class SnapshotCache {
  current: Snapshot | null = null;
  private version = 0;
  private revision = 0;

  beginRefresh(): { version: number; revision: number } {
    return { version: ++this.version, revision: this.revision };
  }

  finishRefresh(snapshot: Snapshot, revision: number): boolean {
    if (revision !== this.revision) return false;
    this.current = snapshot;
    return true;
  }

  setTaskStatus(id: string, status: TaskStatus): Snapshot | null {
    // Invalidate pending reads even if the task is not cached yet.
    this.revision++;
    const previous = this.current;
    const task = previous?.tasks.find(candidate => candidate.id === id);
    if (!previous || !task) return null;

    const openDelta = Number(task.status === 'completed') - Number(status === 'completed');
    this.current = {
      ...previous,
      version: ++this.version,
      takenAt: new Date().toISOString(),
      tasks: previous.tasks.map(candidate => candidate.id === id ? { ...candidate, status } : candidate),
      projects: previous.projects.map(project => project.slug === task.project
        ? { ...project, open: project.open + openDelta }
        : project)
    };
    return this.current;
  }
}
