import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  writeAgentState,
  readAgentStates,
  clearAgentState,
  pruneAgentStates,
  agentStateDir,
  isAgentActivity,
  isLive,
  isCurrent,
  PIDLESS_TTL_MS
} from '../agentState';
import { installActivityHooks, denyPromptsAccess } from '../agentPermissions';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-state-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

// `since` is now, not a fixed date: a pid-less state expires, so a hardcoded
// timestamp makes these tests start failing on their own once it ages past
// the TTL. Expiry has its own tests, which set the age deliberately.
const state = (sessionId: string, activity: 'busy' | 'waiting' | 'idle' = 'busy') => ({
  sessionId,
  activity,
  since: new Date().toISOString(),
  ticket: 'SABIN-0017',
  agent: 'claude'
});

describe('agent state', () => {
  it('round-trips what a hook wrote', async () => {
    await writeAgentState(dir, state('abc', 'waiting'));

    const states = await readAgentStates(dir);
    expect(states.get('abc')?.activity).toBe('waiting');
    expect(states.get('abc')?.ticket).toBe('SABIN-0017');
  });

  it('has nothing to report before any hook has fired', async () => {
    expect((await readAgentStates(dir)).size).toBe(0);
  });

  it('keeps one file per session', async () => {
    await writeAgentState(dir, state('abc', 'busy'));
    await writeAgentState(dir, state('abc', 'idle'));

    expect((await fs.readdir(agentStateDir(dir)))).toHaveLength(1);
    expect((await readAgentStates(dir)).get('abc')?.activity).toBe('idle');
  });

  it('clears a session on SessionEnd', async () => {
    await writeAgentState(dir, state('abc'));
    await clearAgentState(dir, 'abc');

    expect((await readAgentStates(dir)).size).toBe(0);
  });

  it('is silent about clearing something that was never there', async () => {
    await expect(clearAgentState(dir, 'nope')).resolves.toBeUndefined();
  });

  it('drops the state of sessions that are no longer open', async () => {
    // An agent killed mid-turn leaves "busy" behind for ever otherwise
    await writeAgentState(dir, state('alive'));
    await writeAgentState(dir, state('killed'));

    await pruneAgentStates(dir, ['alive']);

    const states = await readAgentStates(dir);
    expect([...states.keys()]).toEqual(['alive']);
  });

  it('skips a file it cannot parse rather than failing the read', async () => {
    await writeAgentState(dir, state('good'));
    await fs.writeFile(path.join(agentStateDir(dir), 'broken.json'), '{ not json');

    expect([...(await readAgentStates(dir)).keys()]).toEqual(['good']);
  });

  it('ignores a state whose activity is not one of ours', async () => {
    await fs.mkdir(agentStateDir(dir), { recursive: true });
    await fs.writeFile(
      path.join(agentStateDir(dir), 'x.json'),
      JSON.stringify({ sessionId: 'x', activity: 'dancing' })
    );

    expect((await readAgentStates(dir)).size).toBe(0);
  });

  it('never lets a session id escape into a path', async () => {
    await writeAgentState(dir, state('../../escaped'));

    const files = await fs.readdir(agentStateDir(dir));
    expect(files).toEqual(['.._.._escaped.json']);
  });

  it('knows which activities are real', () => {
    expect(isAgentActivity('waiting')).toBe(true);
    expect(isAgentActivity('gone')).toBe(false);
  });
});

describe('installActivityHooks', () => {
  it('installs a hook per lifecycle event', async () => {
    const result = await installActivityHooks(dir);
    const settings = JSON.parse(await fs.readFile(result.path, 'utf8'));

    expect(result.added).toEqual(['UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd']);
    expect(settings.hooks.Notification[0].hooks[0].command).toBe('sabin agent-state waiting');
  });

  it('adds nothing the second time', async () => {
    await installActivityHooks(dir);

    expect((await installActivityHooks(dir)).added).toEqual([]);
  });

  it('leaves the prompts deny rule alone', async () => {
    await denyPromptsAccess(dir, '/somewhere/prompts');
    const result = await installActivityHooks(dir);
    const settings = JSON.parse(await fs.readFile(result.path, 'utf8'));

    expect(settings.permissions.deny).toHaveLength(1);
    expect(settings.hooks.Stop).toHaveLength(1);
  });

  it("keeps the project's own hooks for the same event", async () => {
    const settingsPath = path.join(dir, '.claude', 'settings.local.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, JSON.stringify({
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'make lint' }] }] }
    }));

    const settings = JSON.parse(await fs.readFile((await installActivityHooks(dir)).path, 'utf8'));

    expect(settings.hooks.Stop).toHaveLength(2);
    expect(settings.hooks.Stop[0].hooks[0].command).toBe('make lint');
  });

  it('refuses to touch settings it cannot parse', async () => {
    const settingsPath = path.join(dir, '.claude', 'settings.local.json');
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(settingsPath, '{ half written');

    expect((await installActivityHooks(dir)).added).toEqual([]);
    expect(await fs.readFile(settingsPath, 'utf8')).toBe('{ half written');
  });

  it('can be pointed at a different sabin binary', async () => {
    const result = await installActivityHooks(dir, '/opt/sabin');
    const settings = JSON.parse(await fs.readFile(result.path, 'utf8'));

    expect(settings.hooks.Stop[0].hooks[0].command).toBe('/opt/sabin agent-state idle');
  });
});

describe('liveness', () => {
  it('believes a recent state with no pid recorded', async () => {
    await writeAgentState(dir, { ...state('nopid'), since: new Date().toISOString() });

    expect((await readAgentStates(dir)).has('nopid')).toBe(true);
  });

  it('trusts a state whose process is still running', async () => {
    await writeAgentState(dir, { ...state('mine'), pid: process.pid });

    expect((await readAgentStates(dir)).has('mine')).toBe(true);
  });

  it('disbelieves a state whose process is gone', async () => {
    // An agent killed with -9 never runs SessionEnd, so its last state says
    // "busy" for ever unless someone checks
    await writeAgentState(dir, { ...state('killed'), pid: await deadPid() });

    expect((await readAgentStates(dir)).has('killed')).toBe(false);
  });

  it('sweeps a dead state off disk the next time anything is written', async () => {
    await writeAgentState(dir, { ...state('killed'), pid: await deadPid() });
    await writeAgentState(dir, { ...state('alive'), pid: process.pid });

    expect(await fs.readdir(agentStateDir(dir))).toEqual(['alive.json']);
  });

  it('prunes a dead process even when its session is still open', async () => {
    await writeAgentState(dir, { ...state('zombie'), pid: await deadPid() });
    await pruneAgentStates(dir, ['zombie']);

    expect(await fs.readdir(agentStateDir(dir))).toEqual([]);
  });

  it('reads liveness straight', () => {
    expect(isLive(process.pid)).toBe(true);
    expect(isLive(undefined)).toBe(false);
    expect(isLive(0)).toBe(false);
    expect(isLive(-1)).toBe(false);
  });
});

/** A pid that is certainly not running: claim one, then let it exit */
async function deadPid(): Promise<number> {
  const { spawnSync } = await import('child_process');
  // A process that has already exited and been reaped
  const done = spawnSync('true');
  return (done.pid ?? 999999) === process.pid ? 999999 : done.pid ?? 999999;
}

describe('states with no pid', () => {
  const pidless = (sessionId: string, since: string) => ({
    sessionId,
    activity: 'busy' as const,
    since
  });

  it('is believed while it is recent', async () => {
    await writeAgentState(dir, pidless('fresh', new Date().toISOString()));

    expect((await readAgentStates(dir)).has('fresh')).toBe(true);
  });

  it('is given up on eventually', async () => {
    // Process-tree discovery almost always finds the agent, but "almost" is
    // the problem: with no pid there is no liveness signal, and trusting it
    // for ever is the permanent-badge bug again
    const old = new Date(Date.now() - PIDLESS_TTL_MS - 1000).toISOString();
    await writeAgentState(dir, pidless('ancient', old));

    expect((await readAgentStates(dir)).has('ancient')).toBe(false);
  });

  it('is given up on when its timestamp makes no sense', async () => {
    await writeAgentState(dir, pidless('broken', 'not a date'));

    expect((await readAgentStates(dir)).has('broken')).toBe(false);
  });

  it('reads currency straight', () => {
    expect(isCurrent({ pid: process.pid })).toBe(true);
    expect(isCurrent({ since: new Date().toISOString() })).toBe(true);
    expect(isCurrent({})).toBe(false);
  });
});
