import type { ProjectFilter, Snapshot } from '../../shared/types';
import { api } from '../api';
import { Route, useActions } from '../App';
import { Icon, rtlSafe, tildify } from './bits';

interface Props {
  snapshot: Snapshot;
  filter: ProjectFilter;
  onFilter(filter: ProjectFilter): void;
  route: Route;
}

function same(a: ProjectFilter, b: ProjectFilter): boolean {
  return a.kind === b.kind && (a.kind !== 'project' || (b.kind === 'project' && a.slug === b.slug));
}

export function Sidebar({ snapshot, filter, onFilter, route }: Props) {
  const actions = useActions();
  const openTasks = snapshot.tasks.filter(task => task.status !== 'completed');
  const unprojected = openTasks.filter(task => !task.project).length;
  const onList = route.view === 'list';

  const item = (target: ProjectFilter, label: string, count: number, extraClass = '') => {
    const selected = same(filter, target);
    return (
      <button
        type="button"
        class={`side-item ${selected ? (onList ? 'is-selected' : 'is-selected is-muted') : ''} ${extraClass}`}
        onClick={() => onFilter(target)}
        data-filter={target.kind === 'project' ? target.slug : target.kind}
      >
        <span class="side-label">{label}</span>
        {count > 0 && <span class="side-count">{count}</span>}
      </button>
    );
  };

  const newProject = () => actions.prompt({
    title: 'New Project',
    label: 'Name',
    action: 'Create',
    placeholder: 'e.g. Command Center',
    submit: async value => {
      const result = await api.createProject(value);
      if (!result.ok) return result.error;
      onFilter({ kind: 'project', slug: result.value });
      return null;
    }
  });

  const addRepo = async () => {
    const result = await api.addRepo();
    if (!result.ok) actions.toast(result.error);
    else if (result.value) actions.toast(`Added ${result.value}`, 'info');
  };

  const removeRepo = async (name: string) => {
    const result = await api.removeRepo(name);
    if (!result.ok) actions.toast(result.error);
  };

  return (
    <nav class="sidebar">
      <div class="sidebar-drag" />
      <div class="sidebar-scroll">
        <div class="side-section">
          {item({ kind: 'all' }, 'All Tasks', openTasks.length, 'side-item-all')}
        </div>

        <div class="side-section">
          <div class="side-heading">
            <span>Projects</span>
            <button type="button" class="side-add" title="New Project" aria-label="New Project" onClick={newProject}>
              <Icon name="plus" size={12} />
            </button>
          </div>
          {snapshot.projects.map(project => item({ kind: 'project', slug: project.slug }, project.title, project.open))}
          {item({ kind: 'none' }, 'No Project', unprojected, 'side-item-none')}
        </div>

        <div class="side-section">
          <div class="side-heading">
            <span>Repos</span>
            <button type="button" class="side-add" title="Add Repository" aria-label="Add Repository" onClick={addRepo}>
              <Icon name="plus" size={12} />
            </button>
          </div>
          {snapshot.repos.length === 0 ? (
            <div class="side-empty">
              No repositories yet. <button type="button" class="link" onClick={addRepo}>Add one</button> so Sabin can find each task's worktrees.
            </div>
          ) : (
            snapshot.repos.map(repo => (
              <div class={`side-repo ${repo.exists ? '' : 'is-missing'}`} key={repo.name} title={repo.path}>
                <div class="side-repo-text">
                  <span class="side-repo-name">{repo.name}</span>
                  <span class="side-repo-path">{repo.exists ? rtlSafe(tildify(repo.path, snapshot.userHome)) : 'Path not found'}</span>
                </div>
                <button type="button" class="side-remove" title={`Remove ${repo.name}`} aria-label={`Remove ${repo.name}`} onClick={() => removeRepo(repo.name)}>
                  <Icon name="close" size={10} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      <div class="sidebar-foot" title={snapshot.home}>
        <span class="mono">{tildify(snapshot.home, snapshot.userHome)}</span>
      </div>
    </nav>
  );
}
