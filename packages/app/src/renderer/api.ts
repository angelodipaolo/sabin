import type { SabinApi } from '../shared/types';

/** The preload bridge. The only way the page reaches the system. */
export const api: SabinApi = (window as unknown as { sabin: SabinApi }).sabin;
