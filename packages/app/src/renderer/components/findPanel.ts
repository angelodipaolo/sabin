import type { EditorState, Extension } from '@codemirror/state';
import { EditorSelection } from '@codemirror/state';
import { EditorView, type Panel, type ViewUpdate } from '@codemirror/view';
import {
  SearchQuery,
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  search,
  searchKeymap,
  setSearchQuery
} from '@codemirror/search';
import { keymap } from '@codemirror/view';

/** Counting stops here, so a one-letter query in a long file stays cheap */
const COUNT_LIMIT = 999;

interface MatchCount {
  total: number;
  /** 1-based position of the match the selection covers, or 0 */
  current: number;
}

export function countMatches(state: EditorState, query: SearchQuery): MatchCount {
  if (!query.valid) return { total: 0, current: 0 };
  const { from, to } = state.selection.main;
  const cursor = query.getCursor(state);
  let total = 0;
  let current = 0;
  for (let next = cursor.next(); !next.done && total < COUNT_LIMIT; next = cursor.next()) {
    total++;
    if (next.value.from === from && next.value.to === to) current = total;
  }
  return { total, current };
}

/** The first match at or after `from`, wrapping to the top */
function matchFrom(state: EditorState, query: SearchQuery, from: number): { from: number; to: number } | null {
  if (!query.valid) return null;
  const after = query.getCursor(state, from).next();
  if (!after.done) return after.value;
  const top = query.getCursor(state).next();
  return top.done ? null : top.value;
}

function button(label: string, title: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.title = title;
  element.setAttribute('aria-label', title);
  // Keep focus in the field, like a browser's find bar
  element.addEventListener('mousedown', event => event.preventDefault());
  element.addEventListener('click', onClick);
  return element;
}

/** A compact find bar: field, match count, case toggle, previous, next, close */
function createFindPanel(view: EditorView): Panel {
  const dom = document.createElement('div');
  dom.className = 'cm-find';
  dom.setAttribute('role', 'search');

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Find';
  input.setAttribute('aria-label', 'Find');
  // openSearchPanel focuses and selects the field marked main-field
  input.setAttribute('main-field', 'true');
  input.spellcheck = false;

  const count = document.createElement('span');
  count.className = 'cm-find-count';
  count.setAttribute('aria-live', 'polite');

  const caseToggle = button('Aa', 'Match case', () => {
    commit(!getSearchQuery(view.state).caseSensitive, false);
  });
  caseToggle.className = 'cm-find-case';

  const close = () => {
    closeSearchPanel(view);
    view.focus();
  };

  /** findNext and findPrevious select the field; keep the caret where it was, so typing extends the query */
  const step = (command: (target: EditorView) => boolean) => {
    const { selectionStart, selectionEnd } = input;
    command(view);
    if (document.activeElement === input) input.setSelectionRange(selectionStart, selectionEnd);
  };

  const previous = button('↑', 'Previous match (⇧↵)', () => step(findPrevious));
  const next = button('↓', 'Next match (↵)', () => step(findNext));
  const dismiss = button('×', 'Close (Esc)', close);

  dom.append(input, count, caseToggle, previous, next, dismiss);

  const render = () => {
    const query = getSearchQuery(view.state);
    if (input.value !== query.search) input.value = query.search;
    caseToggle.setAttribute('aria-pressed', String(query.caseSensitive));
    caseToggle.classList.toggle('is-on', query.caseSensitive);
    if (!query.search) {
      count.textContent = '';
      dom.classList.remove('is-empty');
      return;
    }
    const { total, current } = countMatches(view.state, query);
    const shown = total >= COUNT_LIMIT ? `${COUNT_LIMIT}+` : String(total);
    count.textContent = total === 0 ? 'No results' : `${current || '?'} of ${shown}`;
    dom.classList.toggle('is-empty', total === 0);
  };

  /** Sets the query and, when it is typed, jumps to the nearest match as you type */
  const commit = (caseSensitive: boolean, jump: boolean) => {
    const query = new SearchQuery({ search: input.value, caseSensitive, literal: true });
    const effects = [setSearchQuery.of(query)];
    const match = jump ? matchFrom(view.state, query, view.state.selection.main.from) : null;
    view.dispatch({
      effects: match ? [...effects, EditorView.scrollIntoView(match.from, { y: 'center' })] : effects,
      selection: match ? EditorSelection.single(match.from, match.to) : undefined,
      userEvent: 'select.search'
    });
  };

  input.addEventListener('input', () => commit(getSearchQuery(view.state).caseSensitive, true));
  input.addEventListener('keydown', event => {
    const modG = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'g';
    if (event.key === 'Enter' || modG) {
      event.preventDefault();
      step(event.shiftKey ? findPrevious : findNext);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  });

  return {
    dom,
    top: true,
    mount() {
      render();
      input.focus();
      input.select();
    },
    update(update: ViewUpdate) {
      const queryChanged = update.transactions.some(tr => tr.effects.some(effect => effect.is(setSearchQuery)));
      if (queryChanged || update.docChanged || update.selectionSet) render();
    }
  };
}

/** Find in the file: ⌘F opens, ↵ and ⇧↵ (or ⌘G and ⇧⌘G) step through matches, Esc closes */
export function findInFile(): Extension {
  return [
    search({ top: true, literal: true, createPanel: createFindPanel }),
    keymap.of(searchKeymap)
  ];
}
