import { useState } from 'preact/hooks';
import type { Snapshot } from '../../shared/types';
import { api } from '../api';
import { useActions } from '../App';
import { Button, tildify } from './bits';

/** Before the home exists: say what it is and offer to make it */
export function FirstRun({ snapshot }: { snapshot: Snapshot }) {
  const actions = useActions();
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    const result = await api.createHome();
    setBusy(false);
    if (!result.ok) actions.toast(result.error);
  };

  return (
    <div class="first-run">
      <div class="first-run-drag" />
      <div class="first-run-card">
        <h1>Welcome to Sabin</h1>
        <p>
          Sabin keeps every task, plan and agent hand-off as plain markdown in one folder,
          and shows you which of your agents need you.
        </p>
        <p>
          There is no Sabin folder at <code>{tildify(snapshot.home, snapshot.userHome)}</code> yet. The usual way to make one is
          to run this in a terminal, which also installs the agent skill and the activity hooks:
        </p>
        <pre class="command">sabin setup --hooks</pre>
        <p class="muted">Or create just the folder now. You can run <code>sabin setup</code> later.</p>
        <div class="first-run-actions">
          <Button kind="primary" onClick={create} disabled={busy}>Create {tildify(snapshot.home, snapshot.userHome)}</Button>
        </div>
        <p class="muted small">Set <code>SABIN_HOME</code> to keep it somewhere else.</p>
      </div>
    </div>
  );
}
