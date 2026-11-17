import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import {
  addRepo,
  createProject,
  createTask,
  createWorkspace,
  ensureHome,
  findRepo,
  getTask,
  readConfig,
  setTaskStatus,
  writeConfig
} from '@sabin/core';

/**
 * A complete, realistic Sabin home in a temporary directory: three projects,
 * eleven tasks in every status, two git repos with worktrees (one task in
 * both, one dirty, one ahead of its upstream), and agent sessions in every
 * activity state. Nothing here touches the real ~/sabin, ~/.claude or ~/.codex.
 */

const run = promisify(execFile);

export interface Fixture {
  root: string;
  home: string;
  userData: string;
  repos: { web: string; api: string };
  worktree(taskId: string, repo: 'web' | 'api'): string;
  cleanup(): Promise<void>;
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-c', 'user.name=Sabin Fixture', '-c', 'user.email=fixture@example.com', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd });
  return stdout.trim();
}

async function write(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
}

async function makeRepo(dir: string, files: Record<string, string>): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, 'init', '-q', '-b', 'main');
  for (const [name, content] of Object.entries(files)) await write(path.join(dir, name), content);
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-q', '-m', 'Initial commit');
  return fs.realpath(dir);
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

/** A pid that is certainly not running, for sessions whose agent has gone */
const DEAD_PID = 2 ** 22 - 3;

export async function buildFixture(livePid = process.pid): Promise<Fixture> {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sabin-app-fixture-')));
  const home = path.join(root, 'sabin');
  const userData = path.join(root, 'user-data');
  await ensureHome(home);
  await writeConfig(home, { idPrefix: 'SABIN', idPadding: 4, branch: { prefix: 'angelo', template: '{prefix}/{id}-{slug}' }, repos: {} });

  const web = await makeRepo(path.join(root, 'projects', 'web'), {
    'README.md': '# web\n\nThe customer dashboard.\n',
    'src/app.ts': "export function start() {\n  console.log('web');\n}\n",
    'src/routes.ts': "export const routes = ['/', '/billing', '/settings'];\n",
    'docs/theme.css': 'body { font-family: system-ui; }\n'
  });
  const api = await makeRepo(path.join(root, 'projects', 'api'), {
    'README.md': '# api\n\nThe billing and webhook service.\n',
    'src/invoices.ts': "export interface Invoice {\n  id: string;\n  total: number;\n}\n\nexport function render(invoice: Invoice): string {\n  return `Invoice ${invoice.id}: ${invoice.total}`;\n}\n",
    'src/webhooks.ts': 'export async function deliver(url: string, body: unknown) {\n  await fetch(url, { method: "POST", body: JSON.stringify(body) });\n}\n'
  });
  await addRepo(home, web);
  await addRepo(home, api);

  await createProject(home, { title: 'Command Center', slug: 'command-center', content: 'The Sabin desktop app.\n' });
  await createProject(home, { title: 'Billing', slug: 'billing' });
  await createProject(home, { title: 'Docs Site', slug: 'docs-site' });

  const config = await readConfig(home);
  const specs: { title: string; project?: string; status: string; id?: string; body?: string }[] = [
    { title: 'Command center desktop app', project: 'command-center', status: 'in_progress', body: '## Goal\n\nOne place to see every task and which agent needs me.\n\n## Done when\n\n- [x] Attention list\n- [ ] Review in Margin\n' },
    { title: 'Attention list grouping', project: 'command-center', status: 'review', body: 'Group tasks by what they ask of the user.\n' },
    { title: 'Invoice PDF export', project: 'billing', status: 'in_progress', body: 'Customers want a PDF next to every invoice.\n' },
    { title: 'Retry failed webhook deliveries', project: 'billing', status: 'in_progress', body: 'Exponential backoff, at most 8 attempts.\n' },
    { title: 'Proration for mid-cycle plan changes', project: 'billing', status: 'open' },
    { title: 'Migrate docs to the new theme', project: 'docs-site', status: 'in_progress' },
    { title: 'Fix broken anchor links', project: 'docs-site', status: 'completed' },
    { title: 'Search index for the API reference', project: 'docs-site', status: 'open' },
    { title: 'Keyboard shortcuts cheat sheet', project: 'command-center', status: 'ready' },
    { title: 'Upgrade Electron to 45', project: 'command-center', status: 'completed' },
    { title: 'Rate limiter for the public API', status: 'review', id: 'ARCH-1234', body: 'Token bucket per API key.\n' }
  ];
  for (const spec of specs) {
    const task = await createTask(home, config, { title: spec.title, project: spec.project, id: spec.id, content: spec.body ?? '', created: '2026-11-10' });
    if (spec.status !== 'open') await setTaskStatus(home, task.id, spec.status);
  }

  const worktrees = new Map<string, string>();
  const workspace = async (taskId: string, repo: 'web' | 'api') => {
    const result = await createWorkspace(config, await getTask(home, taskId), findRepo(config, repo)!, { runPostCreate: false });
    worktrees.set(`${taskId}/${repo}`, result.workspace.path);
    return result.workspace.path;
  };

  // SABIN-0001 in both repos; the web one is two commits ahead of its upstream
  const remote = path.join(root, 'remotes', 'web.git');
  await fs.mkdir(remote, { recursive: true });
  await git(remote, 'init', '-q', '--bare');
  await git(web, 'remote', 'add', 'origin', remote);
  await git(web, 'push', '-q', 'origin', 'main');
  const cc = await workspace('SABIN-0001', 'web');
  await git(cc, 'push', '-q', '-u', 'origin', 'HEAD');
  await write(path.join(cc, 'src/watcher.ts'), 'export function watch() {\n  // debounce state/ longer\n}\n');
  await git(cc, 'add', '.');
  await git(cc, 'commit', '-q', '-m', 'Add the watcher');
  await write(path.join(cc, 'src/app.ts'), "import { watch } from './watcher';\n\nexport function start() {\n  watch();\n}\n");
  await git(cc, 'commit', '-q', '-am', 'Start the watcher');
  await workspace('SABIN-0001', 'api');

  const grouping = await workspace('SABIN-0002', 'web');
  await write(path.join(grouping, 'src/attention.ts'), "export const GROUPS = ['needs-you', 'working', 'in_progress', 'ready', 'open'];\n");
  await git(grouping, 'add', '.');
  await git(grouping, 'commit', '-q', '-m', 'Group the attention list');

  // SABIN-0003 is dirty: a modified file and an untracked one
  const invoices = await workspace('SABIN-0003', 'api');
  await write(path.join(invoices, 'src/invoices.ts'), "export interface Invoice {\n  id: string;\n  total: number;\n  currency: string;\n}\n\nexport function render(invoice: Invoice): string {\n  return `Invoice ${invoice.id}: ${invoice.total} ${invoice.currency}`;\n}\n\nexport async function renderPdf(invoice: Invoice): Promise<Uint8Array> {\n  const text = render(invoice);\n  return new TextEncoder().encode(text);\n}\n");
  await write(path.join(invoices, 'src/pdf.ts'), "export const PAGE = { width: 595, height: 842 };\n");

  const webhooks = await workspace('SABIN-0004', 'api');
  const docs = await workspace('SABIN-0006', 'web');

  // Task files beyond task.md and prompt.md
  const taskDir = (id: string) => path.join(home, 'tasks', id);
  await write(path.join(taskDir('SABIN-0001'), 'plan.md'), '# Plan\n\n1. Snapshot in the main process\n2. Attention list\n3. Task view with the editor\n4. Margin review in a web view\n');
  await write(path.join(taskDir('SABIN-0001'), 'log.md'), '# Log\n\n## 2026-11-15\n\n**Changed:** snapshot and watcher.\n**Proof:** unit tests pass.\n**Risks:** git status cost with many worktrees.\n');
  await write(path.join(taskDir('SABIN-0001'), 'research.md'), '# Research\n\nElectron WebContentsView keeps its own session partition.\n');
  await write(path.join(taskDir('SABIN-0001'), 'prompt.md'), '# SABIN-0001 - Command center desktop app\n\nScratchpad for prompts. Agents never read this file.\n\n---\n\nImplement the attention list next.\n');
  await write(path.join(taskDir('SABIN-0002'), 'plan.md'), '# Plan\n\nWaiting first, longest wait first; then review.\n');

  // Agent sessions, one per activity state
  const sessions = [
    {
      sessionId: '019a7c1e-5b2f-7d40-9c1a-cc0001waiting', agent: 'codex', activity: 'waiting', since: minutesAgo(14), cwd: cc, pid: livePid,
      termSessionId: 'FAKE-TERM-0001',
      lastPrompt: 'Wire the debounced watcher into the snapshot and push it to the renderer.',
      lastPromptAt: minutesAgo(31),
      lastMessage: 'The watcher is in place. I need to run `npm install` to add `@playwright/test`. **Approve the command?**',
      lastMessageAt: minutesAgo(14)
    },
    {
      sessionId: 'b3f1c2d4-0002-idle-claude', agent: 'claude', activity: 'idle', since: minutesAgo(52), cwd: grouping, pid: livePid,
      termSessionId: 'FAKE-TERM-0002',
      lastPrompt: 'Group the attention list and add tests for the ordering.',
      lastPromptAt: minutesAgo(75),
      lastMessage: 'Done. `groupTasks()` now orders **Needs you** by longest wait, then review.\n\n- 14 tests pass\n- Moved ordering into `shared/attention.ts`\n\nReady for review.',
      lastMessageAt: minutesAgo(52)
    },
    {
      sessionId: '019a7c1e-0003-busy-codex', agent: 'codex', activity: 'busy', since: minutesAgo(3), cwd: invoices, pid: livePid,
      termSessionId: 'FAKE-TERM-0003',
      lastPrompt: 'Add PDF rendering for invoices, with currency on every line.',
      lastPromptAt: minutesAgo(3),
      lastMessage: 'Added the currency field. Starting on the PDF renderer.',
      lastMessageAt: minutesAgo(20)
    },
    {
      sessionId: '019a7c1e-0004-ended-codex', agent: 'codex', activity: 'ended', since: minutesAgo(60 * 26), cwd: webhooks, pid: DEAD_PID,
      lastPrompt: 'Sketch the retry schedule.',
      lastPromptAt: minutesAgo(60 * 27),
      lastMessage: 'Proposed schedule: 1m, 5m, 30m, 2h, 6h, 12h, 24h, 48h. Stopped before writing code; see plan.',
      lastMessageAt: minutesAgo(60 * 26)
    },
    {
      sessionId: 'c4d5e6f7-0006-waiting-claude', agent: 'claude', activity: 'waiting', since: minutesAgo(3), cwd: docs, pid: livePid,
      termSessionId: 'FAKE-TERM-0006',
      lastPrompt: 'Port the docs pages to the new theme.',
      lastPromptAt: minutesAgo(9),
      lastMessage: 'Claude needs your permission to use Bash: `rm -rf docs/legacy-theme`'
    },
    {
      sessionId: '019a7c1e-0099-outside', agent: 'codex', activity: 'busy', since: minutesAgo(1), cwd: api, pid: livePid,
      termSessionId: 'FAKE-TERM-0099',
      lastPrompt: 'Why is the CI cache missing on main?'
    }
  ];
  for (const session of sessions) {
    await write(path.join(home, 'state', 'sessions', `${session.sessionId}.json`), `${JSON.stringify(session, null, 2)}\n`);
  }

  return {
    root,
    home,
    userData,
    repos: { web, api },
    worktree: (taskId, repo) => worktrees.get(`${taskId}/${repo}`)!,
    cleanup: async () => {
      for (const dir of worktrees.values()) await run('margin', ['stop'], { cwd: dir }).catch(() => undefined);
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

/** Environment for launching the app against a fixture, with every side effect stubbed */
export function appEnv(fixture: Fixture, extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !['ITERM_SESSION_ID', 'TERM_PROGRAM', 'TERM_SESSION_ID', 'ELECTRON_RUN_AS_NODE'].includes(key)) env[key] = value;
  }
  return {
    ...env,
    SABIN_HOME: fixture.home,
    SABIN_APP_USER_DATA: fixture.userData,
    SABIN_APP_NO_TERMINAL: '1',
    SABIN_APP_NO_NOTIFY: '1',
    SABIN_APP_AUTOCONFIRM: '1',
    SABIN_APP_SHELL_PATH: '0',
    SABIN_APP_NO_VIBRANCY: '1',
    SABIN_APP_WINDOW_SIZE: '1100x720',
    MARGIN_IDLE_TIMEOUT: '120',
    ...extra
  };
}
