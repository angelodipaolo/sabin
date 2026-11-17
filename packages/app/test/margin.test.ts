import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ shell: {}, WebContentsView: class {}, BrowserWindow: class {} }));

const { isAllowedReviewUrl, parseMarginOutput } = await import('../src/main/margin');

describe('parseMarginOutput', () => {
  it('reads the title and URL margin prints', () => {
    expect(parseMarginOutput('Uncommitted changes\nhttp://127.0.0.1:59643/r/working\n'))
      .toEqual({ title: 'Uncommitted changes', url: 'http://127.0.0.1:59643/r/working' });
  });
  it('returns null without a local URL', () => {
    expect(parseMarginOutput('error: not a git repository')).toBeNull();
    expect(parseMarginOutput('http://example.com/r/1')).toBeNull();
  });
});

describe('isAllowedReviewUrl', () => {
  it('allows only Margin on its own port', () => {
    expect(isAllowedReviewUrl('http://127.0.0.1:5000/r/x', '5000')).toBe(true);
    expect(isAllowedReviewUrl('http://127.0.0.1:5001/r/x', '5000')).toBe(false);
    expect(isAllowedReviewUrl('http://localhost:5000/', '5000')).toBe(false);
    expect(isAllowedReviewUrl('https://127.0.0.1:5000/', '5000')).toBe(false);
    expect(isAllowedReviewUrl('javascript:alert(1)', '5000')).toBe(false);
  });
});
