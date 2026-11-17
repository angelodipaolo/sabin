import { useState } from 'preact/hooks';
import { absoluteTime, relativeTime } from '../../shared/time';
import type { SessionInfo, Snapshot, TaskSummary } from '../../shared/types';
import { api } from '../api';
import { useActions } from '../App';
import { AgentBadge, Button, tildify } from './bits';
import { Markdown } from './Markdown';

export function SessionsPanel({ task, snapshot, now }: { task: TaskSummary; snapshot: Snapshot; now: Date }) {
  return (
    <section class="panel" data-testid="sessions-panel">
      <h3 class="panel-title">
        Sessions
        {task.sessions.length > 0 && <span class="panel-count">{task.sessions.length}</span>}
      </h3>
      {task.sessions.length === 0 ? (
        <p class="panel-empty">
          {!snapshot.hooksSeen
            ? <>No agent activity is being recorded. Run <code>sabin setup --hooks</code>, then start an agent in one of this task's worktrees.</>
            : task.workspaces.length === 0
              ? 'Sessions appear here once an agent runs inside one of this task\'s worktrees.'
              : 'No agent has run in this task\'s worktrees yet.'}
        </p>
      ) : (
        task.sessions.map(session => <SessionItem key={session.sessionId} session={session} task={task} snapshot={snapshot} now={now} />)
      )}
    </section>
  );
}

function SessionItem({ session, task, snapshot, now }: { session: SessionInfo; task: TaskSummary; snapshot: Snapshot; now: Date }) {
  const actions = useActions();
  const [expanded, setExpanded] = useState(false);
  const live = session.activity !== 'ended';
  const workspace = task.workspaces.find(candidate => session.cwd === candidate.path || session.cwd.startsWith(`${candidate.path}/`));
  const long = (session.lastMessage?.length ?? 0) > 280 || (session.lastMessage?.split('\n').length ?? 0) > 5;

  const focus = async () => {
    const result = await api.focusSession(session.sessionId);
    if (!result.ok) actions.toast(result.error);
  };
  const resume = async () => {
    const result = await api.resumeSession(session.sessionId);
    if (!result.ok) actions.toast(result.error);
  };

  return (
    <div class={`session session-${session.activity}`} data-session-id={session.sessionId}>
      <div class="session-head">
        <AgentBadge session={session} now={now} />
        <span class="session-where mono" title={session.cwd}>
          {workspace ? workspace.repo : tildify(session.cwd, snapshot.userHome)}
        </span>
        {live ? (
          <Button kind="plain" class="btn-small" onClick={focus} disabled={!session.termSessionId} title={session.termSessionId ? 'Bring its iTerm2 tab to the front' : 'No iTerm2 tab was recorded for this session'}>
            Focus
          </Button>
        ) : (
          <Button kind="plain" class="btn-small" onClick={resume} title={`Open a tab running ${session.agent === 'claude' ? 'claude --resume' : `${session.agent} resume`}`}>
            Resume
          </Button>
        )}
      </div>
      {session.lastPrompt && (
        <div class="session-prompt" title={absoluteTime(session.lastPromptAt)}>
          <span class="session-label">You {session.lastPromptAt && <span class="session-when">{relativeTime(session.lastPromptAt, now)}</span>}</span>
          <div class="session-prompt-text">{session.lastPrompt}</div>
        </div>
      )}
      {session.lastMessage && (
        <div class="session-message" title={absoluteTime(session.lastMessageAt)}>
          <span class="session-label">{session.agent} {session.lastMessageAt && <span class="session-when">{relativeTime(session.lastMessageAt, now)}</span>}</span>
          <div class={`session-message-body ${expanded ? 'is-expanded' : ''}`}>
            <Markdown text={session.lastMessage} />
          </div>
          {long && (
            <button type="button" class="link session-more" onClick={() => setExpanded(value => !value)}>
              {expanded ? 'Show less' : 'Show more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
