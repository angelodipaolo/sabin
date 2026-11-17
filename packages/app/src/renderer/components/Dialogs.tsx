import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Snapshot } from '../../shared/types';
import { api } from '../api';
import { PromptRequest, useActions } from '../App';
import { Button } from './bits';

export function Sheet({ title, onClose, children, width = 440 }: { title: string; onClose(): void; children: ComponentChildren; width?: number }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div class="overlay" onMouseDown={event => event.target === event.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-label={title} style={{ width: `${width}px` }}>
        <h2 class="sheet-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function NewTaskDialog({ snapshot, project, onClose }: { snapshot: Snapshot; project?: string; onClose(): void }) {
  const actions = useActions();
  const [title, setTitle] = useState('');
  const [id, setId] = useState(snapshot.nextId ?? '');
  const [suggested, setSuggested] = useState(snapshot.nextId ?? '');
  const editedId = useRef(false);
  const [slug, setSlug] = useState(project ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => titleRef.current?.focus(), []);

  useEffect(() => {
    let stale = false;
    void api.nextTaskId(slug || undefined).then(result => {
      if (stale) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSuggested(result.value);
      if (!editedId.current) setId(result.value);
    });
    return () => { stale = true; };
  }, [slug, snapshot.version]);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const result = await api.createTask({ title: title.trim(), id: id.trim() === suggested ? undefined : id.trim() || undefined, project: slug || undefined });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onClose();
    actions.openTask(result.value);
  };

  return (
    <Sheet title="New Task" onClose={onClose}>
      <form class="form" onSubmit={submit}>
        <label class="field">
          <span class="field-label">Title</span>
          <input ref={titleRef} name="title" value={title} onInput={event => setTitle(event.currentTarget.value)} placeholder="What needs doing" />
        </label>
        <div class="field-row">
          <label class="field">
            <span class="field-label">ID</span>
            <input name="id" class="mono" value={id} onInput={event => { editedId.current = Boolean(event.currentTarget.value.trim()); setId(event.currentTarget.value); }} placeholder={snapshot.nextId ?? 'ABC-123'} />
          </label>
          <label class="field">
            <span class="field-label">Project <span class="field-hint">optional</span></span>
            <select name="project" value={slug} onChange={event => setSlug(event.currentTarget.value)}>
              <option value="">No project</option>
              {snapshot.projects.map(item => <option key={item.slug} value={item.slug}>{item.title}</option>)}
            </select>
          </label>
        </div>
        {error && <div class="form-error">{error}</div>}
        <div class="sheet-actions">
          <Button kind="plain" onClick={onClose}>Cancel</Button>
          <button type="submit" class="btn btn-primary" disabled={!title.trim() || busy}>Create Task</button>
        </div>
      </form>
    </Sheet>
  );
}

export function TextPrompt({ request, onClose }: { request: PromptRequest; onClose(): void }) {
  const [value, setValue] = useState(request.initial ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    // Select the stem, not the extension, the way Finder does
    const dot = input.value.lastIndexOf('.');
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
  }, []);

  const submit = async (event: Event) => {
    event.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    const problem = await request.submit(value.trim());
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  };

  return (
    <Sheet title={request.title} onClose={onClose} width={380}>
      <form class="form" onSubmit={submit}>
        <label class="field">
          <span class="field-label">{request.label}</span>
          <input ref={inputRef} value={value} placeholder={request.placeholder} onInput={event => setValue(event.currentTarget.value)} />
        </label>
        {error && <div class="form-error">{error}</div>}
        <div class="sheet-actions">
          <Button kind="plain" onClick={onClose}>Cancel</Button>
          <button type="submit" class="btn btn-primary" disabled={!value.trim() || busy}>{request.action}</button>
        </div>
      </form>
    </Sheet>
  );
}
