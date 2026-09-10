import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';

const execFileAsync = promisify(execFile);

const MAX_BUFFER = 8 * 1024 * 1024;

/**
 * Run a command and keep whatever it managed to print, exit code aside.
 *
 * `lsof` exits non-zero when *any* pid in its list has gone away - and asking
 * about every foreground process on the machine means routinely asking about
 * one that has just exited, since a pipeline's `grep` and `cut` are
 * foreground processes with a lifetime of milliseconds. It still prints the
 * rows for every pid that is alive. Treating that exit code as failure threw
 * away the whole listing because one process blinked.
 */
async function capture(command: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command, args, { maxBuffer: MAX_BUFFER });
    return stdout;
  } catch (error) {
    return (error as { stdout?: string }).stdout ?? '';
  }
}

export interface ForegroundJob {
  pid: number;
  /** Whether this process leads its terminal's foreground group */
  leader: boolean;
  /** Full command line, as ps reports it */
  command: string;
  /** The program actually being run - see `programName` */
  program: string;
  cwd: string | null;
}

/**
 * What is running in each terminal, asked of the OS rather than of the
 * terminal.
 *
 * iTerm2 will answer this per session, but only one Apple Event at a time -
 * roughly 45ms each, so a machine with twenty tabs open spends a second on
 * it. Worse, its answer is wrong for the case that matters: Claude Code
 * rewrites its process title to its version number, so iTerm2's `jobName`
 * reads "2.1.246" and no amount of matching against known agent names finds
 * it. `ps` reports the real command line for every tty on the machine in one
 * call, and 40ms.
 */
export async function foregroundJobs(): Promise<Map<string, ForegroundJob[]>> {
  const rows = await ps();
  const jobs = new Map<string, ForegroundJob[]>();

  for (const row of rows) {
    const group = jobs.get(row.tty) ?? [];
    group.push({
      pid: row.pid,
      leader: row.pid === row.pgid,
      command: row.command,
      program: programName(row.command),
      cwd: null
    });
    jobs.set(row.tty, group);
  }

  // Leader first. Everything downstream treats it as the default answer and
  // only overrides it for a better match.
  for (const group of jobs.values()) {
    group.sort((a, b) => Number(b.leader) - Number(a.leader) || a.pid - b.pid);
  }

  await attachWorkingDirectories(jobs);
  return jobs;
}

interface PsRow {
  tty: string;
  pid: number;
  pgid: number;
  command: string;
}

async function ps(): Promise<PsRow[]> {
  const stdout = await capture('ps', ['-eo', 'tty=,pid=,pgid=,stat=,command=']);

  const rows: PsRow[] = [];
  for (const line of stdout.split('\n')) {
    // tty pid pgid stat command...  - the command may contain anything,
    // including the newlines of a composed agent prompt, so only the four
    // fixed fields are split off
    const match = line.match(/^\s*(\S+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!match) continue;

    const [, tty, pid, pgid, stat, command] = match;
    // "+" means the process is in its terminal's foreground group
    if (!stat.includes('+')) continue;
    if (tty === '??' || tty === '-') continue;

    rows.push({ tty, pid: Number(pid), pgid: Number(pgid), command });
  }

  return rows;
}

/**
 * Ask lsof for every pid at once. One call for the whole machine costs about
 * as much as one call for a single process.
 */
async function attachWorkingDirectories(jobs: Map<string, ForegroundJob[]>): Promise<void> {
  const pids = [...jobs.values()].flat().map(job => job.pid);
  if (pids.length === 0) return;

  const cwds = parseCwds(await capture('lsof', ['-a', '-d', 'cwd', '-Fn', '-p', pids.join(',')]));

  for (const group of jobs.values()) {
    for (const job of group) {
      job.cwd = cwds.get(job.pid) ?? null;
    }
  }
}

/**
 * lsof -F output: one field per line, `p<pid>` then `f<fd>` then `n<name>`.
 *
 * Partial output is normal and must still parse - see `capture`.
 */
export function parseCwds(stdout: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid: number | null = null;

  for (const line of stdout.split('\n')) {
    if (line.startsWith('p')) pid = Number(line.slice(1));
    else if (line.startsWith('n') && pid !== null) cwds.set(pid, line.slice(1));
  }

  return cwds;
}

/** Interpreters that tell you nothing; the script they run is the program */
const RUNTIMES = new Set(['node', 'python', 'python3', 'ruby', 'bun', 'deno', 'perl', 'php']);

/**
 * The program a command line is actually running.
 *
 * `-zsh` is a login shell, and `node /usr/local/bin/codex --yolo` is Codex -
 * naming it "node" would put every npm-installed agent in the same bucket.
 */
export function programName(command: string): string {
  const argv = command.trim().split(/\s+/);
  const first = path.basename(argv[0] ?? '').replace(/^-/, '');

  if (RUNTIMES.has(first)) {
    const script = argv.slice(1).find(arg => !arg.startsWith('-'));
    if (script) return path.basename(script);
  }

  return first;
}

export interface AncestorProcess {
  pid: number;
  program: string;
  command: string;
}

/**
 * Walk up from this process to the nearest ancestor that `matches`.
 *
 * A hook is not the agent: Claude Code runs it through a shell, so the hook's
 * own parent is a `sh` that exits a moment later. Recording that pid would
 * make every state look dead within seconds. The agent is somewhere further
 * up, and one `ps` gives the whole tree to walk.
 */
export async function findAncestor(
  matches: (program: string, command: string) => boolean,
  startPid: number = process.pid
): Promise<AncestorProcess | null> {
  const stdout = await capture('ps', ['-eo', 'pid=,ppid=,command=']);

  const tree = new Map<number, { ppid: number; command: string }>();
  for (const line of stdout.split('\n')) {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!match) continue;
    tree.set(Number(match[1]), { ppid: Number(match[2]), command: match[3] });
  }

  let pid: number | undefined = startPid;
  const seen = new Set<number>();

  while (pid && pid > 1 && !seen.has(pid)) {
    seen.add(pid);
    const node = tree.get(pid);
    if (!node) return null;

    const program = programName(node.command);
    if (matches(program, node.command)) {
      return { pid, program, command: node.command };
    }
    pid = node.ppid;
  }

  return null;
}
