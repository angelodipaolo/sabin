import { createContext } from 'preact';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ProjectFilter, Snapshot } from '../shared/types';
import { api } from './api';
import { AttentionList } from './components/AttentionList';
import { FirstRun } from './components/FirstRun';
import { NewTaskDialog, TextPrompt } from './components/Dialogs';
import { QuickSwitcher } from './components/QuickSwitcher';
import { Sidebar } from './components/Sidebar';
import { TaskView } from './components/TaskView';

export type Route = { view: 'list' } | { view: 'task'; id: string };

export interface PromptRequest {
  title: string;
  label: string;
  initial?: string;
  action: string;
  placeholder?: string;
  /** Resolve with an error message to keep the prompt open */
  submit(value: string): Promise<string | null>;
}

type Modal = null | { kind: 'switcher' } | { kind: 'new-task'; project?: string } | { kind: 'prompt'; request: PromptRequest };

interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

export interface AppActions {
  openTask(id: string): void;
  showList(): void;
  toast(text: string, kind?: 'error' | 'info'): void;
  prompt(request: PromptRequest): void;
  newTask(project?: string): void;
  openSwitcher(): void;
  /** True while a dialog covers the window - the review view must step aside */
  overlay: boolean;
}

export const Actions = createContext<AppActions>(null as unknown as AppActions);
export const useActions = () => useContext(Actions);

function readFilter(): ProjectFilter {
  try {
    const saved = JSON.parse(localStorage.getItem('sabin.filter') ?? 'null');
    if (saved && (saved.kind === 'all' || saved.kind === 'none' || (saved.kind === 'project' && typeof saved.slug === 'string'))) return saved;
  } catch {
    // A preference, not data: fall through to the default
  }
  return { kind: 'all' };
}

/** A clock for relative times. Display only - data still arrives only from the watcher. */
function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [route, setRoute] = useState<Route>({ view: 'list' });
  const [filter, setFilterState] = useState<ProjectFilter>(readFilter);
  const [modal, setModal] = useState<Modal>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const backHandler = useRef<(() => boolean) | null>(null);
  const now = useNow();

  const setFilter = useCallback((next: ProjectFilter) => {
    setFilterState(next);
    setRoute({ view: 'list' });
    try {
      localStorage.setItem('sabin.filter', JSON.stringify(next));
    } catch {
      // Remembering the filter is a nicety
    }
  }, []);

  const toast = useCallback((text: string, kind: 'error' | 'info' = 'error') => {
    const id = Date.now() + Math.random();
    setToasts(list => [...list.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts(list => list.filter(item => item.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  const openTask = useCallback((id: string) => {
    setModal(null);
    setRoute({ view: 'task', id });
  }, []);
  const showList = useCallback(() => setRoute({ view: 'list' }), []);

  const back = useCallback(() => {
    if (backHandler.current?.()) return;
    setRoute({ view: 'list' });
  }, []);

  useEffect(() => {
    let alive = true;
    void api.getSnapshot().then(async first => {
      if (!alive) return;
      setSnapshot(first);
      const initial = await api.initialTask();
      if (initial) openTask(initial);
    });
    const offSnapshot = api.onSnapshot(next => setSnapshot(next));
    const offOpen = api.onOpenTask(id => openTask(id));
    return () => {
      alive = false;
      offSnapshot();
      offOpen();
    };
  }, [openTask]);

  const filterSlug = filter.kind === 'project' ? filter.slug : undefined;

  useEffect(() => api.onCommand(command => {
    if (command === 'switcher') setModal(current => (current?.kind === 'switcher' ? null : { kind: 'switcher' }));
    else if (command === 'new-task') setModal({ kind: 'new-task', project: filterSlug });
    else if (command === 'list') {
      setModal(null);
      setRoute({ view: 'list' });
    } else if (command === 'back') {
      if (modal) setModal(null);
      else back();
    }
  }), [back, modal, filterSlug]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || modal || event.defaultPrevented) return;
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest('.cm-editor')) {
        active.blur();
        return;
      }
      if (active && /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName)) {
        active.blur();
        return;
      }
      if (route.view === 'task') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal, route, back]);

  const actions = useMemo<AppActions>(() => ({
    openTask,
    showList,
    toast,
    prompt: request => setModal({ kind: 'prompt', request }),
    newTask: project => setModal({ kind: 'new-task', project }),
    openSwitcher: () => setModal({ kind: 'switcher' }),
    overlay: modal !== null
  }), [openTask, showList, toast, modal]);

  if (!snapshot) return <div class="loading" />;

  if (!snapshot.homeExists) {
    return (
      <Actions.Provider value={actions}>
        <FirstRun snapshot={snapshot} />
        <Toasts toasts={toasts} />
      </Actions.Provider>
    );
  }

  const task = route.view === 'task' ? snapshot.tasks.find(candidate => candidate.id === route.id) ?? null : null;

  return (
    <Actions.Provider value={actions}>
      <div class="app">
        <Sidebar snapshot={snapshot} filter={filter} onFilter={setFilter} route={route} />
        <main class="main">
          {route.view === 'task' ? (
            task ? (
              <TaskView key={task.id} task={task} snapshot={snapshot} now={now} backHandler={backHandler} />
            ) : (
              <MissingTask id={route.id} onBack={showList} />
            )
          ) : (
            <AttentionList snapshot={snapshot} filter={filter} now={now} active={modal === null} />
          )}
        </main>
      </div>
      {modal?.kind === 'switcher' && <QuickSwitcher snapshot={snapshot} onClose={() => setModal(null)} />}
      {modal?.kind === 'new-task' && (
        <NewTaskDialog snapshot={snapshot} project={modal.project} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'prompt' && <TextPrompt request={modal.request} onClose={() => setModal(null)} />}
      <Toasts toasts={toasts} />
    </Actions.Provider>
  );
}

function MissingTask({ id, onBack }: { id: string; onBack: () => void }) {
  return (
    <div class="empty-state">
      <h2>{id} was not found</h2>
      <p>There is no task directory for it, or its task.md could not be read.</p>
      <button type="button" class="btn btn-plain" onClick={onBack}>Back to tasks</button>
    </div>
  );
}

function Toasts({ toasts }: { toasts: Toast[] }) {
  if (toasts.length === 0) return null;
  return (
    <div class="toasts" role="status">
      {toasts.map(item => <div key={item.id} class={`toast toast-${item.kind}`}>{item.text}</div>)}
    </div>
  );
}
