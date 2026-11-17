import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';
import { duration, relativeTime, absoluteTime } from '../../shared/time';
import type { GitState, SessionInfo, TaskStatus, WorkspaceInfo } from '../../shared/types';
import { STATUS_LABELS } from '../../shared/types';

/** Small shared pieces: icons, the agent badge, workspace chips */

type IconName = 'back' | 'plus' | 'terminal' | 'review' | 'copy' | 'folder' | 'search' | 'chevron' | 'warning' | 'close' | 'external' | 'more';

const PATHS: Record<IconName, string> = {
  back: 'M10 3 5 8l5 5',
  plus: 'M8 3v10M3 8h10',
  terminal: 'M3 4.5 6.5 8 3 11.5M8 12h5',
  review: 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z',
  copy: 'M5.5 5.5h7v7h-7zM3.5 10.5v-7h7',
  folder: 'M2.5 4.5h4l1.5 1.5h5.5v6.5h-11z',
  search: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM10.5 10.5l3 3',
  chevron: 'M6 4l4 4-4 4',
  warning: 'M8 2.5 14 13H2zM8 6.5v3M8 11.2v.3',
  close: 'M4 4l8 8M12 4l-8 8',
  external: 'M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01'
};

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg class="icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d={PATHS[name]} fill="none" stroke="currentColor" stroke-width={name === 'more' ? 2.4 : 1.4} stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}

export function Button(props: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'plain' | 'primary' | 'ghost' | 'icon'; children?: ComponentChildren }) {
  const { kind = 'plain', class: className, ...rest } = props;
  return <button type="button" class={`btn btn-${kind} ${className ?? ''}`} {...rest} />;
}

export function ActivityDot({ activity }: { activity: SessionInfo['activity'] }) {
  return <span class={`dot dot-${activity}`} aria-hidden="true" />;
}

const ACTIVITY_WORD: Record<SessionInfo['activity'], string> = {
  waiting: 'Waiting',
  busy: 'Working',
  idle: 'Idle',
  ended: 'Ended'
};

/** `● codex · Waiting 12m` - the wait shows how long, everything else when it last changed */
export function AgentBadge({ session, now }: { session: SessionInfo; now: Date }) {
  const time = session.activity === 'waiting' ? duration(session.since, now) : relativeTime(session.since, now);
  return (
    <span class={`badge badge-${session.activity}`} title={`${session.agent} · ${ACTIVITY_WORD[session.activity]} since ${absoluteTime(session.since)}`}>
      <ActivityDot activity={session.activity} />
      <span class="badge-agent">{session.agent}</span>
      <span class="badge-sep">·</span>
      <span class="badge-activity">{ACTIVITY_WORD[session.activity]}</span>
      {time && <span class="badge-time">{time}</span>}
    </span>
  );
}

export function gitSummary(git: GitState | null): string {
  if (!git) return 'Git state unavailable';
  const parts: string[] = [];
  parts.push(git.dirty === 0 ? 'Clean' : `${git.dirty} uncommitted ${git.dirty === 1 ? 'change' : 'changes'}`);
  if (git.ahead) parts.push(`${git.ahead} ahead`);
  if (git.behind) parts.push(`${git.behind} behind`);
  if (!git.upstream) parts.push('no upstream');
  return parts.join(' · ');
}

/** `sabin •3 ↑2` - counts only when non-zero, so a clean chip is just the repo name */
export function WorkspaceChip({ workspace }: { workspace: WorkspaceInfo }) {
  const git = workspace.git;
  return (
    <span class="chip" title={`${workspace.repo} · ${workspace.branch}\n${gitSummary(git)}`}>
      <span class="chip-repo">{workspace.repo}</span>
      {git && git.dirty > 0 && <span class="chip-dirty">•{git.dirty}</span>}
      {git && git.ahead ? <span class="chip-ab">↑{git.ahead}</span> : null}
      {git && git.behind ? <span class="chip-ab">↓{git.behind}</span> : null}
    </span>
  );
}

export function StatusLabel({ status }: { status: TaskStatus }) {
  return <span class={`status status-${status}`}>{STATUS_LABELS[status]}</span>;
}

/** Home-relative display for paths: /Users/x/projects/a -> ~/projects/a */
export function tildify(path: string, userHome: string | null | undefined): string {
  if (!userHome) return path;
  return path === userHome ? '~' : path.startsWith(`${userHome}/`) ? `~${path.slice(userHome.length)}` : path;
}

/**
 * A path for an element truncated at its start (direction: rtl). The marks
 * keep the bidi algorithm from moving the leading slash to the far end.
 */
export function rtlSafe(path: string): string {
  return `\u200E${path}\u200E`;
}

export function Kbd({ children }: { children: ComponentChildren }) {
  return <kbd class="kbd">{children}</kbd>;
}
