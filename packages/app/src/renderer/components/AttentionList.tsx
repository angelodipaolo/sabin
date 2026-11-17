import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AttentionRow, groupTasks, lastLine, liveUnassigned, matchesFilter } from '../../shared/attention';
import { plainText } from '../../shared/text';
import { duration } from '../../shared/time';
import type { ProjectFilter, SessionInfo, Snapshot } from '../../shared/types';
import { api } from '../api';
import { useActions } from '../App';
import { AgentBadge, Button, Icon, Kbd, WorkspaceChip, tildify } from './bits';

interface Props {
  snapshot: Snapshot;
  filter: ProjectFilter;
  now: Date;
  /** False while a dialog is open, so arrow keys belong to it */
  active: boolean;
}

function filterTitle(snapshot: Snapshot, filter: ProjectFilter): string {
  if (filter.kind === 'all') return 'All Tasks';
  if (filter.kind === 'none') return 'No Project';
  return snapshot.projects.find(project => project.slug === filter.slug)?.title ?? filter.slug;
}

export function AttentionList({ snapshot, filter, now, active }: Props) {
  const actions = useActions();
  const groups = useMemo(() => groupTasks(snapshot.tasks, filter), [snapshot.tasks, filter]);
  const others = filter.kind === 'all' ? liveUnassigned(snapshot.unassigned) : [];
  const [showCompleted, setShowCompleted] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Keyboard order follows what is on screen: folded Completed rows are skipped
  const visible: AttentionRow[] = groups.flatMap(group => (group.key === 'completed' && !showCompleted ? [] : group.rows));
  const ids = visible.map(row => row.task.id);
  const hasTasksAtAll = snapshot.tasks.length > 0;
  const filtered = snapshot.tasks.filter(task => matchesFilter(task, filter));
  const projectSlug = filter.kind === 'project' ? filter.slug : undefined;

  // The handler reads refs, so a key pressed before the next effect runs still sees the current list
  const keys = useRef({ ids, selected, active, open: actions.openTask });
  keys.current = { ids, selected, active, open: actions.openTask };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const { ids: order, selected: current, active: enabled, open } = keys.current;
      if (!enabled) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (target?.closest('.cm-editor')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        if (order.length === 0) return;
        const index = current ? order.indexOf(current) : -1;
        const next = event.key === 'ArrowDown'
          ? order[Math.min(order.length - 1, index + 1)]
          : order[Math.max(0, index === -1 ? 0 : index - 1)];
        keys.current.selected = next;
        setSelected(next);
      } else if (event.key === 'Enter' && current && order.includes(current)) {
        event.preventDefault();
        open(current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!selected) return;
    listRef.current?.querySelector(`[data-task-id="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <section class="list-view">
      <header class="toolbar">
        <h1 class="toolbar-title">{filterTitle(snapshot, filter)}</h1>
        <div class="toolbar-actions">
          <Button kind="ghost" class="switcher-hint" onClick={actions.openSwitcher} title="Go to Task (⌘K)">
            <Icon name="search" size={13} />
            <span>Go to task</span>
            <Kbd>⌘K</Kbd>
          </Button>
          <Button kind="plain" onClick={() => actions.newTask(projectSlug)} title="New Task (⌘N)">
            <Icon name="plus" size={12} />
            <span>New Task</span>
          </Button>
        </div>
      </header>

      <div class="list-scroll" ref={listRef} data-testid="attention-list">
        <Notices snapshot={snapshot} />

        {!hasTasksAtAll ? (
          <div class="empty-state">
            <h2>No tasks yet</h2>
            <p>
              A task is a folder in <code>{tildify(snapshot.home, snapshot.userHome)}/tasks</code> with a <code>task.md</code>,
              a scratchpad and any notes your agents write. Create one here, or run <code>sabin new "Title"</code> in a terminal.
            </p>
            <Button kind="primary" onClick={() => actions.newTask(projectSlug)}>New Task</Button>
          </div>
        ) : filtered.length === 0 ? (
          <div class="empty-state">
            <h2>Nothing in {filterTitle(snapshot, filter)}</h2>
            <p>Tasks join a project from the project picker in the task view, or with <code>sabin new --project</code>.</p>
            <Button kind="plain" onClick={() => actions.newTask(projectSlug)}>New Task</Button>
          </div>
        ) : null}

        {groups.map(group => {
          const folded = group.key === 'completed' && !showCompleted;
          return (
            <div class={`group group-${group.key}`} key={group.key} data-group={group.key}>
              <div
                class={`group-head ${group.key === 'completed' ? 'is-toggle' : ''}`}
                onClick={group.key === 'completed' ? () => setShowCompleted(value => !value) : undefined}
              >
                {group.key === 'completed' && <span class={`disclosure ${folded ? '' : 'is-open'}`}><Icon name="chevron" size={10} /></span>}
                <span class="group-label">{group.label}</span>
                <span class="group-count">{group.rows.length}</span>
              </div>
              {!folded && group.rows.map(row => (
                <TaskRow
                  key={row.task.id}
                  row={row}
                  now={now}
                  showProject={filter.kind === 'all'}
                  selected={selected === row.task.id}
                  onOpen={() => actions.openTask(row.task.id)}
                  onSelect={() => setSelected(row.task.id)}
                />
              ))}
            </div>
          );
        })}

        {others.length > 0 && (
          <div class="group group-others" data-group="others">
            <div class="group-head">
              <span class="group-label">Agents outside tasks</span>
              <span class="group-count">{others.length}</span>
            </div>
            {others.map(session => <OtherAgentRow key={session.sessionId} session={session} snapshot={snapshot} now={now} />)}
          </div>
        )}
      </div>
    </section>
  );
}

function Notices({ snapshot }: { snapshot: Snapshot }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      {!snapshot.hooksSeen && snapshot.tasks.length > 0 && (
        <div class="notice">
          <strong>Agent activity is not reporting.</strong> Run <code>sabin setup --hooks</code> so Claude Code and Codex
          tell Sabin when they are working or waiting for you. New sessions appear here on their own.
        </div>
      )}
      {snapshot.warnings.length > 0 && (
        <div class="notice notice-warning">
          <button type="button" class="notice-toggle" onClick={() => setOpen(value => !value)}>
            <Icon name="warning" size={13} />
            <span>{snapshot.warnings.length === 1 ? '1 problem reading your files' : `${snapshot.warnings.length} problems reading your files`}</span>
            <span class={`disclosure ${open ? 'is-open' : ''}`}><Icon name="chevron" size={10} /></span>
          </button>
          {open && <ul>{snapshot.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
        </div>
      )}
    </>
  );
}

interface RowProps {
  row: AttentionRow;
  now: Date;
  showProject: boolean;
  selected: boolean;
  onOpen(): void;
  onSelect(): void;
}

function TaskRow({ row, now, showProject, selected, onOpen, onSelect }: RowProps) {
  const { task, primary, reason } = row;
  const line = lastLine(primary);
  const quiet = task.workspaces.length === 0 && task.sessions.length === 0;

  return (
    <div
      class={`row reason-${reason} ${quiet ? 'is-quiet' : ''} ${selected ? 'is-selected' : ''} ${line ? '' : 'is-single'}`}
      data-task-id={task.id}
      role="button"
      tabIndex={-1}
      onClick={onOpen}
      onMouseDown={onSelect}
    >
      <span class="row-id mono">{task.id}</span>
      <div class="row-body">
        <div class="row-line">
          <span class="row-title">{task.title}</span>
          {reason === 'review' && <span class="tag tag-review">Review</span>}
          {showProject && task.project && <span class="row-project">{task.project}</span>}
        </div>
        {line && (
          <div class={`row-message ${line.kind === 'prompt' ? 'is-prompt' : ''}`}>
            {line.kind === 'prompt' && <span class="row-you">You:</span>}
            {plainText(line.text)}
          </div>
        )}
      </div>
      <div class="row-meta">
        {task.workspaces.map(workspace => <WorkspaceChip key={workspace.path} workspace={workspace} />)}
        {primary && <AgentBadge session={primary} now={now} />}
        {reason === 'waiting' && row.waitingSince && primary?.activity !== 'waiting' && (
          <span class="badge badge-waiting">Waiting {duration(row.waitingSince, now)}</span>
        )}
      </div>
    </div>
  );
}

function OtherAgentRow({ session, snapshot, now }: { session: SessionInfo; snapshot: Snapshot; now: Date }) {
  const actions = useActions();
  const line = lastLine(session);
  const focus = async () => {
    const result = await api.focusSession(session.sessionId);
    if (!result.ok) actions.toast(result.error);
  };
  return (
    <div class={`row row-other reason-${session.activity === 'waiting' ? 'waiting' : 'status'} ${line ? '' : 'is-single'}`}>
      <span class="row-id mono">—</span>
      <div class="row-body">
        <div class="row-line">
          <span class="row-title mono row-path">{tildify(session.cwd, snapshot.userHome)}</span>
        </div>
        {line && <div class="row-message">{line.kind === 'prompt' && <span class="row-you">You:</span>}{plainText(line.text)}</div>}
      </div>
      <div class="row-meta">
        <AgentBadge session={session} now={now} />
        {session.termSessionId && <Button kind="plain" class="btn-small" onClick={focus}>Focus</Button>}
      </div>
    </div>
  );
}
