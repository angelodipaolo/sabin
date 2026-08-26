// The board: one column per active status, completed folded away.
// Rendering is data-driven from the extension; every action posts a ticket
// back and the extension resolves paths itself.
(function () {
  const vscode = acquireVsCodeApi();
  const board = document.getElementById('board');
  const STATUSES = board.dataset.statuses.split(',');
  const ACTIVE = STATUSES.filter(status => status !== 'completed');

  const state = { tasks: [], collapsed: new Set(), showCompleted: false };

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
  const ICON_DELETE = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

  function renderCard(task) {
    const ticket = escapeHtml(task.ticket);
    const options = STATUSES.map(status =>
      `<div class="status-option" data-action="setStatus" data-status="${status}" data-ticket="${ticket}">` +
      `<span class="status-badge status-${status}">${label(status)}</span></div>`
    ).join('');

    return `
      <div class="card" data-ticket="${ticket}">
        <div class="card-header">
          <div class="card-id">
            <button class="ticket" data-action="focus" data-ticket="${ticket}" title="Focus this task">${ticket}</button>
            ${task.hasPlan ? `<button class="icon plan" data-action="openPlan" data-ticket="${ticket}" title="Open plan">${ICON_PLAN}</button>` : ''}
          </div>
          <div class="card-actions">
            <span class="secondary">
              <button class="icon" data-action="copyPath" data-ticket="${ticket}" title="Copy task path">${ICON_COPY}</button>
              <button class="icon danger" data-action="deleteTask" data-ticket="${ticket}" title="Delete task">${ICON_DELETE}</button>
            </span>
            <span class="status-menu">
              <button class="status-badge status-${task.status}" data-action="toggleMenu" data-ticket="${ticket}" title="Change status">${label(task.status)} ▾</button>
              <div class="status-dropdown" data-ticket="${ticket}">${options}</div>
            </span>
          </div>
        </div>
        <h4 class="title" data-action="openTask" data-ticket="${ticket}">${escapeHtml(task.title)}</h4>
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
  }

  function closeMenus() {
    document.querySelectorAll('.status-dropdown.show').forEach(el => el.classList.remove('show'));
  }

  board.addEventListener('click', event => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const { action, ticket, status } = target.dataset;

    switch (action) {
      case 'newTask': post({ command: 'newTask' }); break;
      case 'focus': post({ command: 'focus', ticket }); break;
      case 'openTask': post({ command: 'openTask', ticket }); break;
      case 'openPlan': post({ command: 'openPlan', ticket }); break;
      case 'copyPath': post({ command: 'copyPath', ticket }); break;
      case 'deleteTask': post({ command: 'deleteTask', ticket }); break;
      case 'setStatus': post({ command: 'setStatus', ticket, status }); closeMenus(); break;
      case 'toggleMenu': {
        event.stopPropagation();
        const menu = board.querySelector(`.status-dropdown[data-ticket="${CSS.escape(ticket)}"]`);
        const open = menu.classList.contains('show');
        closeMenus();
        if (!open) menu.classList.add('show');
        return;
      }
      case 'toggleColumn':
        if (state.collapsed.has(status)) state.collapsed.delete(status); else state.collapsed.add(status);
        render();
        break;
      case 'showCompleted': state.showCompleted = true; render(); break;
      case 'showBoard': state.showCompleted = false; render(); break;
    }
  });

  document.addEventListener('click', event => {
    if (!event.target.closest('.status-menu')) closeMenus();
  });

  window.addEventListener('message', event => {
    if (event.data.command === 'tasks') {
      state.tasks = event.data.tasks;
      render();
    }
  });

  post({ command: 'refresh' });
})();
