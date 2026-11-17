#!/usr/bin/env node

/**
 * `agent-state` runs several times per agent turn, from hooks, so it takes a
 * fast path: no Commander, no other command modules, nothing on stdout, and
 * exit 0 whatever happens.
 */
if (process.argv[2] === 'agent-state') {
  import('./commands/agent-state')
    .then(({ agentState }) => agentState())
    .catch(() => undefined)
    .finally(() => process.exit(0));
} else {
  import('./program')
    .then(({ run }) => run(process.argv))
    .catch(error => {
      console.error(String(error?.message ?? error));
      process.exit(1);
    });
}
