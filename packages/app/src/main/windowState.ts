import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, Rectangle, screen } from 'electron';

/** Window layout is the one piece of state the app keeps of its own */

interface WindowState {
  bounds: Rectangle;
  maximized: boolean;
}

const DEFAULT = { width: 1280, height: 820 };

function stateFile(): string {
  return path.join(app.getPath('userData'), 'window-state.json');
}

export function loadWindowState(): Partial<WindowState> {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as WindowState;
    const visible = screen.getAllDisplays().some(display => {
      const area = display.workArea;
      return state.bounds.x < area.x + area.width && state.bounds.x + state.bounds.width > area.x &&
        state.bounds.y < area.y + area.height && state.bounds.y + state.bounds.height > area.y;
    });
    return visible ? state : { bounds: { ...DEFAULT, x: 0, y: 0 } };
  } catch {
    return {};
  }
}

export function trackWindowState(win: BrowserWindow): void {
  let timer: NodeJS.Timeout | null = null;
  const save = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed()) return;
      const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() };
      try {
        fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
        fs.writeFileSync(stateFile(), JSON.stringify(state));
      } catch {
        // Layout is a convenience; failing to keep it is not worth a message
      }
    }, 400);
  };
  win.on('resize', save);
  win.on('move', save);
  win.on('close', save);
}

export const DEFAULT_SIZE = DEFAULT;
