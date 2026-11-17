import { useState } from 'preact/hooks';
import type { Snapshot, TaskSummary, WorkspaceInfo } from '../../shared/types';
import { api } from '../api';
import { useActions } from '../App';
import { Button, Icon, gitSummary, rtlSafe, tildify } from './bits';

interface Props {
  task: TaskSummary;
  snapshot: Snapshot;
  onReview(workspace: WorkspaceInfo): void;
}

export function WorkspacesPanel({ task, snapshot, onReview }: Props) {
  const actions = useActions();
  const [creating, setCreating] = useState<string | null>(null);
  const taken = new Set(task.workspaces.map(workspace => workspace.repo));
  const available = snapshot.repos.filter(repo => repo.exists && !taken.has(repo.name));

  const create = async (repo: string) => {
    if (!repo) return;
    setCreating(repo);
    const result = await api.createWorkspace(task.id, repo);
    setCreating(null);
    if (!result.ok) actions.toast(result.error);
    else actions.toast(`Created worktree ${tildify(result.value, snapshot.userHome)}`, 'info');
  };

  return (
    <section class="panel" data-testid="workspaces-panel">
      <h3 class="panel-title">
        Workspaces
        {task.workspaces.length > 0 && <span class="panel-count">{task.workspaces.length}</span>}
      </h3>
      {task.workspaces.length === 0 && (
        <p class="panel-empty">
          {snapshot.repos.length === 0
            ? 'No repositories are registered. Add one in the sidebar, then create a worktree for this task here.'
            : <>No worktree has a branch naming {task.id} yet. Create one below, or run <code>sabin work {task.id}</code> in a repo.</>}
        </p>
      )}
      {task.workspaces.map(workspace => (
        <WorkspaceItem key={workspace.path} task={task} workspace={workspace} snapshot={snapshot} onReview={() => onReview(workspace)} />
      ))}
      {available.length > 0 && (
        <label class="select-wrap create-worktree">
          <select
            value=""
            disabled={creating !== null}
            onChange={event => {
              const value = event.currentTarget.value;
              event.currentTarget.value = '';
              void create(value);
            }}
            aria-label="Create worktree in"
          >
            <option value="">{creating ? `Creating in ${creating}…` : 'Create worktree in…'}</option>
            {available.map(repo => <option key={repo.name} value={repo.name}>{repo.name}</option>)}
          </select>
        </label>
      )}
    </section>
  );
}

function WorkspaceItem({ task, workspace, snapshot, onReview }: { task: TaskSummary; workspace: WorkspaceInfo; snapshot: Snapshot; onReview(): void }) {
  const actions = useActions();
  const git = workspace.git;

  const terminal = async () => {
    const result = await api.openTerminal(task.id, workspace.path);
    if (!result.ok) actions.toast(result.error);
  };
  const reveal = async () => {
    const result = await api.reveal(task.id, workspace.path);
    if (!result.ok) actions.toast(result.error);
  };
  const copy = async () => {
    await api.copyText(workspace.path);
    actions.toast('Path copied', 'info');
  };

  return (
    <div class="workspace" data-workspace={workspace.repo}>
      <div class="workspace-head">
        <span class="workspace-repo">{workspace.repo}</span>
        {workspace.main && <span class="tag">main clone</span>}
        <span class="workspace-tools">
          <Button kind="icon" onClick={copy} title="Copy path" aria-label="Copy path"><Icon name="copy" size={13} /></Button>
          <Button kind="icon" onClick={reveal} title="Reveal in Finder" aria-label="Reveal in Finder"><Icon name="folder" size={13} /></Button>
        </span>
      </div>
      <div class="workspace-branch mono" title={workspace.branch}>{workspace.branch}</div>
      <div class="workspace-path mono" title={workspace.path}>{rtlSafe(tildify(workspace.path, snapshot.userHome))}</div>
      <div class={`workspace-git ${git && git.dirty > 0 ? 'is-dirty' : ''}`}>{gitSummary(git)}</div>
      <div class="workspace-actions">
        <Button kind="plain" class="btn-small" onClick={terminal}>
          <Icon name="terminal" size={12} />
          Terminal
        </Button>
        <Button kind="plain" class="btn-small" onClick={onReview} title={snapshot.redeAvailable ? 'Review the diff in Rede' : 'Needs Rede on your PATH'}>
          <Icon name="review" size={12} />
          Review
        </Button>
      </div>
    </div>
  );
}
