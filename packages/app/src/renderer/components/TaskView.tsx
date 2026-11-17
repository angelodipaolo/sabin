import type { RefObject } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
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
  const [openNotes, setOpenNotes] = useState<string[]>(() => FILE_ORDER.includes(current) ? [] : [current]);
  const [menuOpen, setMenuOpen] = useState(false);
  const tabList = useRef<HTMLDivElement>(null);
  const select = (name: string) => {
    if (!FILE_ORDER.includes(name)) setOpenNotes(names => names.includes(name) ? names : [...names, name]);
    onSelect(name);
    setMenuOpen(false);
  };
  const opened = openNotes.map(name => notes.find(entry => entry.name === name)).filter((entry): entry is TaskFileEntry => Boolean(entry));
  const tabs = [...fixed, ...opened];

  useEffect(() => {
    if (files.length === 0) return;
    setOpenNotes(names => names.filter(name => notes.some(entry => entry.name === name)));
  }, [files]);

  useLayoutEffect(() => {
    const navigate = (offset: number) => {
      if (actions.overlay) return;
      const available = tabs.filter(entry => entry.exists);
      if (available.length === 0) return;
      const index = available.findIndex(entry => entry.name === current);
      select(available[(index + offset + available.length) % available.length].name);
    };
    const off = api.onCommand(command => {
      if (command === 'next-tab') navigate(1);
      if (command === 'previous-tab') navigate(-1);
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === 'Tab' && !actions.overlay) {
        event.preventDefault();
        event.stopPropagation();
        navigate(event.shiftKey ? -1 : 1);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { off(); window.removeEventListener('keydown', onKey, true); };
  }, [current, files, openNotes, actions.overlay]);

  useLayoutEffect(() => {
    tabList.current?.querySelector('.is-current')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [current, files, openNotes]);

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const dismiss = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
      } else if ((event.target as HTMLElement).closest('.notes-picker')) return;
      setMenuOpen(false);
    };
    window.addEventListener('mousedown', dismiss);
    window.addEventListener('keydown', dismiss, true);
    return () => { window.removeEventListener('mousedown', dismiss); window.removeEventListener('keydown', dismiss, true); };
  }, [menuOpen]);

  const close = (name: string) => {
    setOpenNotes(names => names.filter(item => item !== name));
    if (current === name) {
      const index = tabs.findIndex(entry => entry.name === name);
      onSelect(tabs[Math.max(0, index - 1)]?.name ?? 'task.md');
    }
  };

  const create = async (name: string) => {
    const result = await api.createFile(task.id, name);
    if (!result.ok) {
      actions.toast(result.error);
      return result.error;
    }
    select(result.value);
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
      select(result.value);
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
          setOpenNotes(names => names.map(item => item === name ? result.value : item));
          if (current === name) select(result.value);
          return null;
        }
      });
    } else if (choice === 'delete') {
      const result = await api.deleteFile(task.id, name);
      if (!result.ok) actions.toast(result.error);
      else if (result.value) close(name);
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
      <div class={`file-tab-group ${current === entry.name ? 'is-current' : ''}`} key={entry.name} onMouseDown={event => event.preventDefault()}>
        <button
          type="button"
          role="tab"
          aria-selected={current === entry.name}
          class={`file-tab ${current === entry.name ? 'is-current' : ''}`}
          onClick={() => select(entry.name)}
          onContextMenu={event => void contextMenu(event, entry.name)}
          data-file={entry.name}
        >
          {entry.name}
        </button>
        {entry.kind === 'note' && <button type="button" class="tab-close" aria-label={`Close ${entry.name}`} onClick={() => close(entry.name)}>×</button>}
      </div>
    );
  };

  return (
    <>
      <div class="file-tabs" ref={tabList} role="tablist" aria-label="Files">
        {fixed.map(tab)}
        {opened.length > 0 && <span class="file-sep" />}
        {opened.map(tab)}
      </div>
      <div class="notes-picker">
        <button type="button" class="file-tab file-new" onClick={() => setMenuOpen(value => !value)} aria-expanded={menuOpen} aria-haspopup="menu" title="Browse notes">
          <span>Notes</span><Icon name="chevron" size={10} />
        </button>
        {menuOpen && <div class="notes-menu" role="menu" aria-label="Notes">
          <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); newNote(); }}><Icon name="plus" size={11} /> Note</button>
          {notes.map(entry => <button type="button" role="menuitem" key={entry.name} onClick={() => select(entry.name)}>{entry.name}</button>)}
        </div>}
      </div>
    </>
  );
}
