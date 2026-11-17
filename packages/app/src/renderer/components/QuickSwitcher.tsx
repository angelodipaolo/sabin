import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { fuzzyFilter } from '../../shared/fuzzy';
import { STATUS_LABELS, Snapshot, TaskSummary } from '../../shared/types';
import { compareIds, rowFor } from '../../shared/attention';
import { useActions } from '../App';
import { StatusLabel } from './bits';

const LIMIT = 60;

/** Open tasks first, the ones that need you on top; completed last */
function defaultOrder(tasks: TaskSummary[]): TaskSummary[] {
  const rank = (task: TaskSummary) => {
    const group = rowFor(task).group;
    return ['needs-you', 'working', 'in_progress', 'ready', 'open', 'completed'].indexOf(group);
  };
  return [...tasks].sort((a, b) => rank(a) - rank(b) || compareIds(b.id, a.id));
}

export function QuickSwitcher({ snapshot, onClose }: { snapshot: Snapshot; onClose(): void }) {
  const actions = useActions();
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const ordered = useMemo(() => defaultOrder(snapshot.tasks), [snapshot.tasks]);
  const results = useMemo(
    () => fuzzyFilter(ordered, query, task => [task.id, task.title, task.project ?? '', STATUS_LABELS[task.status]]).slice(0, LIMIT),
    [ordered, query]
  );

  useLayoutEffect(() => inputRef.current?.focus(), []);
  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    listRef.current?.children[index]?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex(value => Math.min(results.length - 1, value + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex(value => Math.max(0, value - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const chosen = results[index];
      if (chosen) actions.openTask(chosen.item.id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div class="overlay overlay-top" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div class="switcher" role="dialog" aria-label="Go to task">
        <input
          ref={inputRef}
          autoFocus
          class="switcher-input"
          value={query}
          placeholder="Go to task — ID, title, project or status"
          onInput={event => setQuery(event.currentTarget.value)}
          onKeyDown={onKey}
          spellcheck={false}
        />
        <div class="switcher-list" ref={listRef}>
          {results.length === 0 && <div class="switcher-empty">No task matches “{query}”</div>}
          {results.map(({ item }, position) => (
            <div
              key={item.id}
              class={`switcher-row ${position === index ? 'is-active' : ''}`}
              data-task-id={item.id}
              onMouseMove={() => setIndex(position)}
              onClick={() => actions.openTask(item.id)}
            >
              <span class="mono switcher-id" title={item.id}>{item.id}</span>
              <span class="switcher-title">{item.title}</span>
              {item.project && <span class="switcher-project">{item.project}</span>}
              <StatusLabel status={item.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
