import chalk from 'chalk';
import { AgentActivity } from '@sabin/core';

const BADGES: Record<AgentActivity, { mark: string; label: string; paint: (text: string) => string }> = {
  waiting: { mark: '●', label: 'waiting for you', paint: chalk.yellow },
  busy: { mark: '◐', label: 'busy', paint: chalk.cyan },
  idle: { mark: '○', label: 'idle', paint: chalk.gray }
};

/**
 * A badge for what an agent is doing, or nothing at all.
 *
 * No activity is not a state - an agent with no hooks installed, or one that
 * has not taken a turn yet, gets no badge rather than a guessed one.
 */
export function activityBadge(activity: AgentActivity | null, since: string | null): string {
  if (!activity) return '';

  const badge = BADGES[activity];
  const age = elapsed(since);
  return badge.paint(`${badge.mark} ${badge.label}${age ? ` ${age}` : ''}`);
}

export function activityText(activity: AgentActivity | null, since: string | null): string {
  if (!activity) return '';
  const age = elapsed(since);
  return `${BADGES[activity].label}${age ? ` ${age}` : ''}`;
}

/** "14s", "6m", "2h" - how long it has been in this state */
export function elapsed(since: string | null): string {
  if (!since) return '';

  const ms = Date.now() - Date.parse(since);
  if (!Number.isFinite(ms) || ms < 0) return '';

  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}
