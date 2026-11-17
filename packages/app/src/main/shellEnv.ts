import { spawn } from 'child_process';

const MARK = '__SABIN_PATH__';

/** Pull the PATH out of shell output that may carry banners and rc-file noise */
export function extractMarkedPath(output: string): string | null {
  const start = output.indexOf(MARK);
  if (start === -1) return null;
  const end = output.indexOf(MARK, start + MARK.length);
  if (end === -1) return null;
  const value = output.slice(start + MARK.length, end).trim();
  return value || null;
}

/** The shell's entries first, then anything only the current PATH had, without duplicates */
export function mergePath(shellPath: string | null, current: string | undefined): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of [...(shellPath ?? '').split(':'), ...(current ?? '').split(':')]) {
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    out.push(entry);
  }
  return out.join(':');
}

/**
 * The PATH a login shell would have. An app started from Finder inherits
 * launchd's minimal PATH, which has no Homebrew, no ~/.local/bin and no npm
 * globals - so no `rede`, and maybe not the git the user expects. Asked once
 * at startup, with a timeout, because an interactive rc file can do anything.
 */
export function loginShellPath(timeoutMs = 4000): Promise<string | null> {
  const shell = process.env.SHELL || '/bin/zsh';
  return new Promise(resolve => {
    let output = '';
    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(shell, ['-ilc', `printf '${MARK}%s${MARK}' "$PATH"`], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env: { ...process.env, TERM: 'dumb' }
      });
    } catch {
      resolve(null);
      return;
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      finish(extractMarkedPath(output));
    }, timeoutMs);

    child.stdout?.on('data', chunk => {
      output += chunk.toString();
    });
    child.on('error', () => finish(null));
    child.on('close', () => finish(extractMarkedPath(output)));
  });
}

/** Resolve the login PATH and put it on process.env, which every child process inherits */
export async function adoptLoginShellPath(): Promise<void> {
  const shellPath = await loginShellPath();
  process.env.PATH = mergePath(shellPath, process.env.PATH ?? '/usr/bin:/bin:/usr/sbin:/sbin');
}
