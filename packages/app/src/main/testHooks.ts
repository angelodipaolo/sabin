/**
 * What the end-to-end tests read back through `electronApp.evaluate`: the
 * calls the fake terminal received and the notifications that would have
 * been shown. Lives on globalThis so the test can reach it from outside the
 * bundle.
 */
export interface TestHooks {
  terminal: Record<string, unknown>[];
  notifications: { title: string; body: string; taskId: string | null }[];
  /** Set in test runs: the review view as an image, for screenshots */
  captureReview?: () => Promise<{ dataUrl: string; bounds: { x: number; y: number; width: number; height: number }; loading: boolean } | null>;
}

export function testHooks(): TestHooks {
  const store = globalThis as unknown as { __sabinTest?: TestHooks };
  store.__sabinTest ??= { terminal: [], notifications: [] };
  return store.__sabinTest;
}
