import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Annotation, EditorState } from '@codemirror/state';
import { EditorView, drawSelection, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { api } from '../api';
import { useActions } from '../App';
import { openSearchPanel } from '@codemirror/search';
import { findInFile } from './findPanel';
import { onMarkdownClick, renderMarkdown } from './Markdown';

export type EditorMode = 'edit' | 'preview' | 'split';

const SAVE_DELAY_MS = 600;
/** Marks changes that came from disk, so they do not schedule a save */
const fromDisk = Annotation.define<boolean>();

const highlight = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: '650', fontSize: '1.25em' },
  { tag: tags.heading2, fontWeight: '650', fontSize: '1.12em' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], fontWeight: '650' },
  { tag: tags.strong, fontWeight: '650' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--accent)' },
  { tag: tags.monospace, fontFamily: 'var(--mono)', fontSize: '0.92em', color: 'var(--code)' },
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: 'var(--text-3)' },
  { tag: tags.quote, color: 'var(--text-2)' }
]);

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px', backgroundColor: 'transparent', color: 'var(--text)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--sans)', lineHeight: '1.6', padding: '18px 0 40vh' },
  '.cm-content': { padding: '0 28px', maxWidth: '820px', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0' },
  '.cm-cursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '1.5px' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': { backgroundColor: 'var(--selection) !important' },
  '.cm-placeholder': { color: 'var(--text-3)' },
  '.cm-panels': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-panels-top': { borderBottom: 'none' },
  '.cm-searchMatch': { backgroundColor: 'var(--amber-soft)', outline: '1px solid var(--amber)', borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--amber)', color: 'var(--bg)' },
  '.cm-searchMatch-selected *': { color: 'inherit' }
});

function readMode(): EditorMode {
  try {
    const saved = localStorage.getItem('sabin.editorMode');
    if (saved === 'edit' || saved === 'preview' || saved === 'split') return saved;
  } catch {
    // Preference only
  }
  return 'edit';
}

interface Props {
  taskId: string;
  name: string;
  /** Snapshot version: a change means something under the home was written */
  version: number;
  /** The file tabs, shown on the editor's own toolbar row */
  tabs?: ComponentChildren;
}

type SaveState = 'saved' | 'saving' | 'unsaved' | 'error';

/**
 * A markdown file on disk, edited in place. Autosaves shortly after typing
 * stops and on blur. When the file changes underneath, a clean buffer
 * reloads; a dirty one is kept and a bar offers reload or keep.
 */
export function Editor({ taskId, name, version, tabs }: Props) {
  const actions = useActions();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // Mutable state the CodeMirror callbacks read; refs, so they never see a stale render
  const file = useRef({ taskId, name, baseline: '', loaded: false, saving: false, timer: 0 as unknown as ReturnType<typeof setTimeout> });
  const [mode, setModeState] = useState<EditorMode>(readMode);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [conflict, setConflict] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [preview, setPreview] = useState('');

  const setMode = (next: EditorMode) => {
    setModeState(next);
    try {
      localStorage.setItem('sabin.editorMode', next);
    } catch {
      // Preference only
    }
  };

  const text = () => view.current?.state.doc.toString() ?? '';

  const save = async () => {
    const current = file.current;
    clearTimeout(current.timer);
    if (!view.current || !current.loaded || current.saving) return;
    const content = text();
    if (content === current.baseline) {
      setSaveState('saved');
      return;
    }
    const { taskId: savingTask, name: savingName } = current;
    const previous = current.baseline;
    current.saving = true;
    current.baseline = content;
    setSaveState('saving');
    const result = await api.writeFile(savingTask, savingName, content);
    current.saving = false;
    if (!result.ok && file.current !== current) actions.toast(`Could not save ${savingName}: ${result.error}`);
    if (file.current !== current) return;
    if (!result.ok) {
      current.baseline = previous;
      setSaveState('error');
      actions.toast(`Could not save ${savingName}: ${result.error}`);
      return;
    }
    // Typing may have continued while the write was in flight
    if (text() !== current.baseline) schedule();
    else setSaveState('saved');
  };

  const schedule = () => {
    clearTimeout(file.current.timer);
    setSaveState('unsaved');
    file.current.timer = setTimeout(() => void save(), SAVE_DELAY_MS);
  };

  const replaceDoc = (content: string) => {
    const editor = view.current;
    if (!editor) return;
    const head = Math.min(editor.state.selection.main.head, content.length);
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: content },
      selection: { anchor: head },
      annotations: fromDisk.of(true)
    });
  };

  // One CodeMirror instance for the component's life; files swap its state
  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({ doc: '' })
    });
    view.current = editor;
    return () => {
      void save();
      editor.destroy();
      view.current = null;
    };
  }, []);

  // Load the file whenever the task or file changes, after flushing the last one
  useEffect(() => {
    let stale = false;
    const editor = view.current!;
    const load = async () => {
      await save();
      if (stale) return;
      file.current = { taskId, name, baseline: '', loaded: false, saving: false, timer: file.current.timer };
      setConflict(null);
      setMissing(false);
      const result = await api.readFile(taskId, name);
      if (stale) return;
      const content = result.ok ? result.value.content : '';
      if (!result.ok) actions.toast(result.error);
      else if (!result.value.exists) setMissing(true);
      editor.setState(EditorState.create({
        doc: content,
        extensions: [
          history(),
          drawSelection(),
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          findInFile(),
          markdown(),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          theme,
          placeholder(name === 'prompt.md' ? 'Draft prompts here. Agents never read this file.' : 'Empty'),
          EditorView.contentAttributes.of({ 'aria-label': name, spellcheck: 'true' }),
          EditorView.updateListener.of(update => {
            if (!update.docChanged) return;
            setPreview(update.state.doc.toString());
            if (update.transactions.some(tr => tr.annotation(fromDisk))) return;
            schedule();
          }),
          EditorView.domEventHandlers({
            blur: () => {
              void save();
            }
          })
        ]
      }));
      file.current.baseline = content;
      file.current.loaded = true;
      setPreview(content);
      setSaveState('saved');
    };
    void load();
    return () => {
      stale = true;
    };
  }, [taskId, name]);

  // Something under the home changed: was it this file?
  useEffect(() => {
    const current = file.current;
    if (!current.loaded) return;
    let stale = false;
    void (async () => {
      if (current.saving) return;
      const { taskId: checkedTask, name: checkedName } = current;
      const result = await api.readFile(checkedTask, checkedName);
      if (stale || !result.ok || current.saving || !current.loaded) return;
      if (file.current !== current || current.taskId !== checkedTask || current.name !== checkedName) return;
      if (!result.value.exists) {
        setMissing(true);
        return;
      }
      setMissing(false);
      const disk = result.value.content;
      if (disk === current.baseline) return;
      if (text() === current.baseline) {
        clearTimeout(current.timer);
        replaceDoc(disk);
        current.baseline = disk;
        setConflict(null);
        setSaveState('saved');
      } else {
        setConflict(disk);
      }
    })();
    return () => {
      stale = true;
    };
  }, [version]);

  // ⌘F when the editor is not focused, or is hidden behind the preview
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.shiftKey) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return;
      const editor = view.current;
      if (!editor || !file.current.loaded) return;
      const target = event.target as HTMLElement | null;
      // Another field (a dialog, the switcher) keeps its own keys
      if (target?.closest('input, textarea, [contenteditable="true"]') && !editor.dom.contains(target)) return;
      if (document.querySelector('dialog[open], [role="dialog"]')) return;
      event.preventDefault();
      if (mode !== 'preview') {
        openSearchPanel(editor);
        return;
      }
      // The source pane is hidden in preview; show it before focusing the field
      setMode('split');
      requestAnimationFrame(() => openSearchPanel(editor));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  const reload = () => {
    if (conflict === null) return;
    clearTimeout(file.current.timer);
    replaceDoc(conflict);
    file.current.baseline = conflict;
    setConflict(null);
    setSaveState('saved');
  };

  const keep = () => {
    if (conflict === null) return;
    // Treat the disk version as seen; the next save writes the buffer over it
    file.current.baseline = conflict;
    setConflict(null);
    void save();
  };

  const saveLabel = { saved: 'Saved', saving: 'Saving…', unsaved: 'Edited', error: 'Not saved' }[saveState];

  return (
    <div class={`editor mode-${mode}`}>
      <div class="editor-head">
        {tabs}
        <div class="editor-tools">
        <span class={`save-state save-${saveState}`} data-testid="save-state">{saveLabel}</span>
        <div class="segmented" role="tablist" aria-label="Editor mode">
          {(['edit', 'split', 'preview'] as EditorMode[]).map(option => (
            <button
              type="button"
              key={option}
              role="tab"
              aria-selected={mode === option}
              class={mode === option ? 'is-on' : ''}
              onClick={() => setMode(option)}
            >
              {option === 'edit' ? 'Edit' : option === 'split' ? 'Split' : 'Preview'}
            </button>
          ))}
        </div>
        </div>
      </div>
      {conflict !== null && (
        <div class="file-bar" role="alert">
          <span>{name} changed on disk.</span>
          <button type="button" class="link" onClick={reload}>Reload</button>
          <button type="button" class="link" onClick={keep}>Keep mine</button>
        </div>
      )}
      {missing && (
        <div class="file-bar" role="alert">
          <span>{name} is not on disk any more. Edits here will not be saved.</span>
        </div>
      )}
      <div class="editor-panes">
        <div class="editor-pane editor-source" ref={host} data-testid="editor" />
        <div
          class="editor-pane editor-preview markdown"
          onClick={onMarkdownClick}
          dangerouslySetInnerHTML={{ __html: mode === 'edit' ? '' : renderMarkdown(preview) }}
        />
      </div>
    </div>
  );
}
