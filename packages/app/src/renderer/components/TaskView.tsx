import type { RefObject } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { TASK_STATUSES, STATUS_LABELS, Snapshot, TaskFileEntry, TaskStatus, TaskSummary, WorkspaceInfo } from '../../shared/types';
import { api } from '../api';
import { useActions } from '../App';
import { Button, Icon } from './bits';
import { Editor } from './Editor';
import { ReviewPane } from './ReviewPane';
import { SessionsPanel } from './Sessions';
import { WorkspacesPanel } from './Workspaces';

interface Props {
  task: TaskSummary;
  snapshot: Snapshot;
  now: Date;
  /** App asks this first on Back, so an open review closes before the view does */
  backHandler: RefObject<(() => boolean) | null>;
}

const FILE_ORDER = ['task.md', 'prompt.md', 'plan.md', 'log.md'];

function rememberedFile(taskId: string): string {
  try {
    return localStorage.getItem(`sabin.file.${taskId}`) ?? 'task.md';
  } catch {
    return 'task.md';
  }
}

export function TaskView({ task, snapshot, now, backHandler }: Props) {
  const actions = useActions();
  const [files, setFiles] = useState<TaskFileEntry[]>([]);
  const [current, setCurrentState] = useState<string>(() => rememberedFile(task.id));
  const [review, setReview] = useState<WorkspaceInfo | null>(null);

  const setCurrent = (name: string) => {
    setCurrentState(name);
    try {
      localStorage.setItem(`sabin.file.${task.id}`, name);
    } catch {
      // Preference only
    }
  };

  useEffect(() => {
    backHandler.current = () => {
      if (!review) return false;
      setReview(null);
      return true;
    };
    return () => {
      backHandler.current = null;
    };
  }, [review]);

  // The file list follows the disk: re-read on every snapshot
  useEffect(() => {
    let stale = false;
    void api.listFiles(task.id).then(result => {
      if (stale) return;
      if (!result.ok) {
        actions.toast(result.error);
        return;
      }
      setFiles(result.value);
      const exists = result.value.some(entry => entry.name === current && entry.exists);
      if (!exists) setCurrent('task.md');
    });
    return () => {
      stale = true;
    };
  }, [task.id, snapshot.version]);

  // A workspace that went away closes its review
  useEffect(() => {
    if (review && !task.workspaces.some(workspace => workspace.path === review.path)) setReview(null);
  }, [task.workspaces, review]);

  return (
    <section class="task-view">
      <TaskHeader task={task} snapshot={snapshot} />
      {review ? (
        <ReviewPane task={task} workspace={review} onClose={() => setReview(null)} />
      ) : (
        <div class="task-body">
          <div class="task-main">
            <Editor
              key={`${task.id}/${current}`}
              taskId={task.id}
              name={current}
              version={snapshot.version}
              tabs={<FileTabs task={task} files={files} current={current} onSelect={setCurrent} />}
            />
          </div>
          <aside class="inspector">
            <SessionsPanel task={task} snapshot={snapshot} now={now} />
            <WorkspacesPanel task={task} snapshot={snapshot} onReview={setReview} />
          </aside>
        </div>
      )}
    </section>
  );
}

function TaskHeader({ task, snapshot }: { task: TaskSummary; snapshot: Snapshot }) {
  const actions = useActions();
  const [title, setTitle] = useState(task.title);

  // Follow the disk unless the field is being edited
  useEffect(() => {
    if (document.activeElement?.getAttribute('name') !== 'task-title') setTitle(task.title);
  }, [task.title]);

  const commitTitle = async () => {
    const next = title.trim();
    if (!next || next === task.title) {
      setTitle(task.title);
      return;
    }
    const result = await api.updateTask(task.id, { title: next });
    if (!result.ok) {
      actions.toast(result.error);
      setTitle(task.title);
    }
  };

  const setStatus = async (status: TaskStatus) => {
    const result = await api.setStatus(task.id, status);
    if (!result.ok) actions.toast(result.error);
  };

  const setProject = async (value: string) => {
    if (value === '__new__') {
      actions.prompt({
        title: 'New Project',
        label: 'Name',
        action: 'Create and Assign',
        submit: async name => {
          const created = await api.createProject(name);
          if (!created.ok) return created.error;
          const assigned = await api.updateTask(task.id, { project: created.value });
          return assigned.ok ? null : assigned.error;
        }
      });
      return;
    }
    const result = await api.updateTask(task.id, { project: value || null });
    if (!result.ok) actions.toast(result.error);
  };

  return (
    <header class="toolbar task-toolbar">
      <Button kind="icon" class="back" onClick={actions.showList} title="Back to tasks (⌘[)" aria-label="Back to tasks">
        <Icon name="back" size={15} />
      </Button>
      <span class="task-id mono" title="Copy ID" onClick={() => void api.copyText(task.id).then(() => actions.toast(`Copied ${task.id}`, 'info'))}>
        {task.id}
      </span>
      <input
        name="task-title"
        class="title-input"
        value={title}
        onInput={event => setTitle(event.currentTarget.value)}
        onBlur={commitTitle}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur();
          if (event.key === 'Escape') {
            setTitle(task.title);
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        aria-label="Title"
        spellcheck={false}
      />
      <div class="header-controls">
        <label class={`select-wrap status-select status-${task.status}`} title="Status">
          <span class="status-dot" aria-hidden="true" />
          <select name="status" value={task.status} onChange={event => setStatus(event.currentTarget.value as TaskStatus)} aria-label="Status">
            {TASK_STATUSES.map(status => <option key={status} value={status}>{STATUS_LABELS[status]}</option>)}
          </select>
        </label>
        <label class="select-wrap" title="Project">
          <select name="project" value={task.project ?? ''} onChange={event => setProject(event.currentTarget.value)} aria-label="Project">
            <option value="">No project</option>
            {snapshot.projects.map(project => <option key={project.slug} value={project.slug}>{project.title}</option>)}
            <option disabled>──────────</option>
            <option value="__new__">New Project…</option>
          </select>
        </label>
      </div>
    </header>
  );
}

function FileTabs({ task, files, current, onSelect }: { task: TaskSummary; files: TaskFileEntry[]; current: string; onSelect(name: string): void }) {
  const actions = useActions();
  const fixed = FILE_ORDER.map(name => files.find(entry => entry.name === name)).filter((entry): entry is TaskFileEntry => Boolean(entry));
  const notes = files.filter(entry => entry.kind === 'note');

  const create = async (name: string) => {
    const result = await api.createFile(task.id, name);
    if (!result.ok) {
      actions.toast(result.error);
      return result.error;
    }
    onSelect(result.value);
    return null;
  };

  const newNote = () => actions.prompt({
    title: 'New Note',
    label: 'File name',
    action: 'Create',
    placeholder: 'research.md',
    submit: async name => {
      const result = await api.createFile(task.id, name);
      if (!result.ok) return result.error;
      onSelect(result.value);
      return null;
    }
  });

  const contextMenu = async (event: MouseEvent, name: string) => {
    event.preventDefault();
    const choice = await api.fileMenu(task.id, name);
    if (choice === 'rename') {
      actions.prompt({
        title: 'Rename Note',
        label: 'File name',
        initial: name,
        action: 'Rename',
        submit: async next => {
          const result = await api.renameFile(task.id, name, next);
          if (!result.ok) return result.error;
          if (current === name) onSelect(result.value);
          return null;
        }
      });
    } else if (choice === 'delete') {
      const result = await api.deleteFile(task.id, name);
      if (!result.ok) actions.toast(result.error);
      else if (result.value && current === name) onSelect('task.md');
    } else if (choice === 'reveal') {
      const result = await api.revealFile(task.id, name);
      if (!result.ok) actions.toast(result.error);
    }
  };

  const tab = (entry: TaskFileEntry) => {
    if (!entry.exists) {
      return (
        <button type="button" key={entry.name} class="file-tab is-absent" onClick={() => void create(entry.name)} title={`Create ${entry.name}`}>
          <Icon name="plus" size={10} />
          {entry.name}
        </button>
      );
    }
    return (
      <button
        type="button"
        key={entry.name}
        class={`file-tab ${current === entry.name ? 'is-current' : ''}`}
        onClick={() => onSelect(entry.name)}
        onContextMenu={event => void contextMenu(event, entry.name)}
        data-file={entry.name}
      >
        {entry.name}
      </button>
    );
  };

  return (
    <>
      <div class="file-tabs" role="tablist" aria-label="Files">
        {fixed.map(tab)}
        {notes.length > 0 && <span class="file-sep" />}
        {notes.map(tab)}
      </div>
      <button type="button" class="file-tab file-new" onClick={newNote} title="New Note" aria-label="New Note">
        <Icon name="plus" size={11} />
        <span>Note</span>
      </button>
    </>
  );
}
