import { execFile } from 'child_process';
import { BrowserWindow, WebContentsView, shell } from 'electron';
import type { Bounds, MarginResult } from '../shared/types';

/**
 * Margin is a separate tool. Sabin only runs its CLI and shows the page it
 * serves - as a top-level document in its own view, because Margin's server
 * rejects cross-site framed requests.
 */

export const MARGIN_INSTALL_HINT =
  'Margin is not installed. Install it from its repository with `npm install && npm run build && npm link`, then try again.';

/** `margin --no-open` prints a title line and the review URL */
export function parseMarginOutput(stdout: string): MarginResult | null {
  const lines = stdout.split('\n').map(line => line.trim()).filter(Boolean);
  const index = lines.findIndex(line => /^http:\/\/127\.0\.0\.1:\d+\//.test(line));
  if (index === -1) return null;
  const url = lines[index].split(/\s+/)[0];
  const title = lines.slice(0, index).reverse().find(line => !/^https?:/.test(line)) ?? 'Review';
  return { url, title };
}

/** Only Margin's own origin, on the port it reported, may load in the view */
export function isAllowedReviewUrl(url: string, port: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1' && parsed.port === port;
  } catch {
    return false;
  }
}

export function findMargin(): Promise<string | null> {
  return new Promise(resolve => {
    execFile('/bin/sh', ['-c', 'command -v margin'], { timeout: 3000 }, (error, stdout) => {
      resolve(error ? null : stdout.trim() || null);
    });
  });
}

/**
 * Run `margin --no-open` in a worktree and let Margin decide what to review:
 * uncommitted changes when there are any, else the branch against the
 * default branch.
 */
export function runMargin(cwd: string): Promise<MarginResult> {
  return new Promise((resolve, reject) => {
    execFile('margin', ['--no-open'], { cwd, timeout: 30_000, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(MARGIN_INSTALL_HINT));
        return;
      }
      const parsed = parseMarginOutput(stdout);
      if (parsed) {
        resolve(parsed);
        return;
      }
      const detail = (stderr || stdout || (error ? error.message : '')).trim().split('\n').slice(-3).join(' ');
      reject(new Error(detail ? `Margin could not open a review: ${detail}` : 'Margin printed no review URL.'));
    });
  });
}

/**
 * The one review view, laid over the task view's main area. It keeps its own
 * persistent session partition: Margin keeps drafts in localStorage per
 * origin, and a reviewer's half-written comment must survive a restart.
 */
export class ReviewView {
  private view: WebContentsView | null = null;
  private port = '';
  private url = '';
  private bounds: Bounds = { x: 0, y: 0, width: 0, height: 0 };
  /** URLs margin printed this session; the renderer can only show one of these */
  private issued = new Set<string>();

  constructor(private readonly window: () => BrowserWindow | null) {}

  allow(url: string): void {
    this.issued.add(url);
  }

  private ensure(win: BrowserWindow): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;
    const view = new WebContentsView({
      webPreferences: {
        partition: 'persist:margin',
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    const guard = (event: { preventDefault(): void }, target: string) => {
      if (isAllowedReviewUrl(target, this.port)) return;
      event.preventDefault();
      if (/^https?:/.test(target)) void shell.openExternal(target);
    };
    view.webContents.on('will-navigate', (event, target) => guard(event, target));
    view.webContents.on('will-redirect', (event, target) => guard(event, target));
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedReviewUrl(url, this.port)) void view.webContents.loadURL(url);
      else if (/^https?:/.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    win.contentView.addChildView(view);
    this.view = view;
    return view;
  }

  show(url: string, bounds: Bounds): void {
    if (!this.issued.has(url)) throw new Error('That review URL was not opened by Sabin.');
    const win = this.window();
    if (!win) return;
    const view = this.ensure(win);
    this.bounds = bounds;
    view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height))
    });
    view.setVisible(true);
    if (url !== this.url) {
      this.port = new URL(url).port;
      this.url = url;
      void view.webContents.loadURL(url);
    }
  }

  hide(): void {
    if (this.view && !this.view.webContents.isDestroyed()) {
      this.view.setVisible(false);
      this.window()?.webContents.focus();
    }
  }

  /** For screenshots: the review page as a PNG data URL, and where it sits in the window */
  async capture(): Promise<{ dataUrl: string; bounds: Bounds; loading: boolean } | null> {
    if (!this.view || this.view.webContents.isDestroyed()) return null;
    const image = await this.view.webContents.capturePage();
    return { dataUrl: image.toDataURL(), bounds: this.bounds, loading: this.view.webContents.isLoading() };
  }
}
