// The index: one column per active status, completed folded away.
// Rendering is data-driven from the extension; every action posts a ticket
// back and the extension resolves paths itself.
//
// The card is one click target - it opens the ticket's detail view. The small
// buttons on it carry their own `data-action`, and the delegated listener
// resolves to the nearest one, so they never need to stop propagation.
(function () {
  const vscode = acquireVsCodeApi();
  const board = document.getElementById('board');
  const STATUSES = board.dataset.statuses.split(',');
  const ACTIVE = STATUSES.filter(status => status !== 'completed');

  // The `when`-clause split disposes this webview whenever the detail view
  // takes the slot, so anything held only in a local object is gone by the
  // time `←` brings the index back - collapsed columns, the scroll offset, and
  // which of the two boards you were on. `vscode.setState` outlives that, and
  // costs nothing while hidden the way `retainContextWhenHidden` would.
  const saved = vscode.getState() || {};
  const state = {
    tasks: [],
    collapsed: new Set(saved.collapsed || []),
    showCompleted: Boolean(saved.showCompleted),
    scrollTop: saved.scrollTop || 0
  };

  function save() {
    vscode.setState({
      collapsed: [...state.collapsed],
      showCompleted: state.showCompleted,
      scrollTop: state.scrollTop
    });
  }

  function post(message) {
    vscode.postMessage(message);
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function label(status) {
    return status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  }

  const ICON_PLAN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>';
  const ICON_COPY = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
  const ICON_TERMINAL = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>';
  const ICON_AGENT = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="3"></circle><line x1="12" y1="1" x2="12" y2="4"></line><line x1="12" y1="20" x2="12" y2="23"></line><line x1="1" y1="12" x2="4" y2="12"></line><line x1="20" y1="12" x2="23" y2="12"></line></svg>';
  const ICON_TICKET = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"></path><line x1="7" y1="7" x2="7.01" y2="7"></line></svg>';
  const ICON_DELETE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

const ACTIVITY_LABEL = {
  waiting: 'waiting for you',
  busy: 'busy',
  idle: 'idle'
};

/**
 * A dot for what the ticket's agents are doing, or nothing.
 *
 * Nothing is the honest answer when no hook has reported: an agent with no
 * hooks installed is not idle, it is unknown, and a grey dot claiming
 * otherwise would be worse than no dot.
 */
function renderActivity(task) {
  if (!task.activity) return '';

  const label = ACTIVITY_LABEL[task.activity] || task.activity;
  const count = task.agents > 1 ? ` (${task.agents})` : '';
  return `<span class="activity activity-${task.activity}" title="${label}${count}"></span>`;
}


  function renderCard(task) {
    const ticket = escapeHtml(task.ticket);
    const options = STATUSES.map(status =>
      `<div class="status-option" data-action="setStatus" data-status="${status}" data-ticket="${ticket}">` +
      `<span class="status-badge status-${status}">${label(status)}</span></div>`
    ).join('');

    return `
      <div class="card" tabindex="0" aria-label="Open ${ticket}" data-action="open" data-ticket="${ticket}" title="Open ${ticket}">
        <div class="card-header">
          <div class="card-id">
            <span class="ticket">${ticket}</span>
            ${renderActivity(task)}
            ${task.hasPlan ? `<button class="icon plan" data-action="openPlan" data-ticket="${ticket}" title="Open plan">${ICON_PLAN}</button>` : ''}
          </div>
          <div class="card-actions">
            <span class="secondary">
              ${task.activity ? `<button class="icon" data-action="gotoAgent" data-ticket="${ticket}" title="Go to agent">${ICON_AGENT}</button>` : ''}
              ${task.hasWorktree ? `<button class="icon" data-action="openTerminal" data-ticket="${ticket}" title="Open terminal in worktree">${ICON_TERMINAL}</button>` : ''}
              <button class="icon" data-action="copyTicket" data-ticket="${ticket}" title="Copy ticket ID">${ICON_TICKET}</button>
              <button class="icon" data-action="copyPath" data-ticket="${ticket}" title="Copy task path">${ICON_COPY}</button>
              <button class="icon danger" data-action="deleteTask" data-ticket="${ticket}" title="Delete task">${ICON_DELETE}</button>
            </span>
            <span class="status-menu">
              <button class="status-badge status-${task.status}" data-action="toggleMenu" data-ticket="${ticket}" title="Change status">${label(task.status)} ▾</button>
              <div class="status-dropdown" data-ticket="${ticket}">${options}</div>
            </span>
          </div>
        </div>
        <h4 class="title">${escapeHtml(task.title)}</h4>
        ${task.branch ? `<div class="branch" title="${escapeHtml(task.branch)}">${escapeHtml(task.branch)}</div>` : ''}
      </div>`;
  }

  function renderColumn(status, tasks, collapsible) {
    const collapsed = state.collapsed.has(status);
    return `
      <div class="column">
        <h3 class="column-header${collapsible ? ' clickable' : ''}" data-action="${collapsible ? 'toggleColumn' : ''}" data-status="${status}">
          ${label(status)} <span class="count">${tasks.length}</span>${collapsible ? `<span class="chevron">${collapsed ? '▸' : '▾'}</span>` : ''}
        </h3>
        <div class="cards${collapsed ? ' collapsed' : ''}">${tasks.map(renderCard).join('')}</div>
      </div>`;
  }

  function render() {
    const grouped = {};
    for (const status of STATUSES) grouped[status] = [];
    for (const task of state.tasks) (grouped[task.status] || (grouped.open = grouped.open || [])).push(task);

    if (state.showCompleted) {
      board.innerHTML =
        `<div class="toolbar"><button class="link" data-action="showBoard">← Back to board</button></div>` +
        (grouped.completed.length ? renderColumn('completed', grouped.completed, false) : '<p class="empty">No completed tasks</p>');
      restoreScroll();
      return;
    }

    let html = `<div class="toolbar"><button class="link" data-action="newTask">+ New task</button></div>`;
    let any = false;
    for (const status of ACTIVE) {
      if (grouped[status].length === 0) continue;
      any = true;
      html += renderColumn(status, grouped[status], true);
    }
    if (!any) html += '<p class="empty">No open tasks. Create one with + New task, or <code>sabin task create</code>.</p>';
    if (grouped.completed.length) {
      html += `<div class="column"><h3 class="column-header"><button class="link" data-action="showCompleted">Completed <span class="count">${grouped.completed.length}</span></button></h3></div>`;
    }
    board.innerHTML = html;
    restoreScroll();
  }

  /**
   * Replacing `innerHTML` drops the scroll offset, so put it back in the same
   * frame - before a paint - and the board does not visibly jump. The browser
   * clamps to the new content height, and the scroll listener records whatever
   * it settles on.
   */
  function restoreScroll() {
    window.scrollTo(0, state.scrollTop);
    save();
  }

  function closeMenus() {
    document.querySelectorAll('.status-dropdown.show').forEach(el => el.classList.remove('show'));
  }

  function act(target, event) {
    const { action, ticket, status } = target.dataset;

    switch (action) {
      case 'newTask': post({ command: 'newTask' }); break;
      case 'open': post({ command: 'open', ticket }); break;
      case 'openPlan': post({ command: 'openPlan', ticket }); break;
      case 'copyTicket': post({ command: 'copyTicket', ticket }); break;
      case 'gotoAgent': post({ command: 'gotoAgent', ticket }); break;
      case 'openTerminal': post({ command: 'openTerminal', ticket }); break;
      case 'copyPath': post({ command: 'copyPath', ticket }); break;
      case 'deleteTask': post({ command: 'deleteTask', ticket }); break;
      case 'setStatus': post({ command: 'setStatus', ticket, status }); closeMenus(); break;
      case 'toggleMenu': {
        if (event) event.stopPropagation();
        const menu = board.querySelector(`.status-dropdown[data-ticket="${CSS.escape(ticket)}"]`);
        const open = menu.classList.contains('show');
        closeMenus();
        if (!open) menu.classList.add('show');
        break;
      }
      case 'toggleColumn':
        if (state.collapsed.has(status)) state.collapsed.delete(status); else state.collapsed.add(status);
        render();
        break;
      // A different board, so start at the top of it rather than at the offset
      // that belonged to the other one
      case 'showCompleted': state.showCompleted = true; state.scrollTop = 0; render(); break;
      case 'showBoard': state.showCompleted = false; state.scrollTop = 0; render(); break;
    }
  }

  board.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (target) act(target, event);
  });

  /**
   * A focused card answers to Enter and Space, and only a focused card does.
   *
   * `closest` walks *up*, which is right for a mouse - the event target is
   * whatever was actually under the pointer - and exactly wrong for a
   * keypress, where the target is the focused element and its nearest
   * `[data-action]` ancestor is the card. Without the identity check, Enter on
   * "Copy ticket ID" resolves to the card and `preventDefault()` swallows the
   * click the button would have fired, so every per-card action becomes
   * unreachable from the keyboard.
   */
  board.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target.closest('.card[data-action]');
    if (!target || event.target !== target) return;
    event.preventDefault();
    act(target, event);
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.status-menu')) closeMenus();
  });

  // Cheap enough at one write per frame, and the offset has to survive the
  // webview being disposed behind the detail view
  let scrollPending = false;
  window.addEventListener('scroll', () => {
    if (scrollPending) return;
    scrollPending = true;
    requestAnimationFrame(() => {
      scrollPending = false;
      state.scrollTop = window.scrollY;
      save();
    });
  }, { passive: true });

  window.addEventListener('message', event => {
    if (event.data.command === 'tasks') {
      state.tasks = event.data.tasks;
      render();
    }
  });

  post({ command: 'refresh' });
})();
