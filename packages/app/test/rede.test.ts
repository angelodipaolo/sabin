import { describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';

const native = vi.hoisted(() => ({ setBounds: vi.fn() }));
vi.mock('electron', () => ({
  shell: {},
  BrowserWindow: class {},
  WebContentsView: class {
    webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn(), loadURL: vi.fn() };
    setBounds = native.setBounds;
    setVisible = vi.fn();
  }
}));

const { isAllowedReviewUrl, parseRedeOutput, ReviewView } = await import('../src/main/rede');

it.each([0.8, 1, 1.5])('positions the native review view at zoom factor %s', zoom => {
  const win = {
    webContents: { getZoomFactor: () => zoom },
    contentView: { addChildView: vi.fn() }
  } as unknown as BrowserWindow;
  const review = new ReviewView(() => win);
  const url = 'http://127.0.0.1:5000/r/working';
  review.allow(url);
  review.show(url, { x: 250, y: 100, width: 800, height: 600 });
  expect(native.setBounds).toHaveBeenLastCalledWith({ x: 250 * zoom, y: 100 * zoom, width: 800 * zoom, height: 600 * zoom });
});

describe('parseRedeOutput', () => {
  it('reads the title and URL rede prints', () => {
    expect(parseRedeOutput('Uncommitted changes\nhttp://127.0.0.1:59643/r/working\n'))
      .toEqual({ title: 'Uncommitted changes', url: 'http://127.0.0.1:59643/r/working' });
  });
  it('returns null without a local URL', () => {
    expect(parseRedeOutput('error: not a git repository')).toBeNull();
    expect(parseRedeOutput('http://example.com/r/1')).toBeNull();
  });
});

describe('isAllowedReviewUrl', () => {
  it('allows only Rede on its own port', () => {
    expect(isAllowedReviewUrl('http://127.0.0.1:5000/r/x', '5000')).toBe(true);
    expect(isAllowedReviewUrl('http://127.0.0.1:5001/r/x', '5000')).toBe(false);
    expect(isAllowedReviewUrl('http://localhost:5000/', '5000')).toBe(false);
    expect(isAllowedReviewUrl('https://127.0.0.1:5000/', '5000')).toBe(false);
    expect(isAllowedReviewUrl('javascript:alert(1)', '5000')).toBe(false);
  });
});
