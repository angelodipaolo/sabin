/**
 * Task IDs: `^[A-Z][A-Z0-9]*-\d+$`, uppercased on input.
 *
 * An ID becomes a directory name, so this pattern is also the path-safety
 * check: nothing that passes it can contain a separator or `..`. That is why
 * every lookup validates, not just create.
 */
export const TASK_ID_PATTERN = /^[A-Z][A-Z0-9]*-\d+$/;

/** The canonical (trimmed, uppercased) ID, or null when `input` is not one */
export function parseTaskId(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const id = input.trim().toUpperCase();
  return TASK_ID_PATTERN.test(id) ? id : null;
}

/** Whether `input` is a task ID (in any case) */
export function isTaskId(input: string | null | undefined): boolean {
  return parseTaskId(input) !== null;
}

/** Split a canonical ID into its prefix and number: ARCH-0012 -> ['ARCH', 12] */
export function splitTaskId(id: string): [string, number] {
  const dash = id.lastIndexOf('-');
  return [id.slice(0, dash), parseInt(id.slice(dash + 1), 10)];
}

/**
 * Order IDs by prefix, then numerically, so SABIN-2 precedes SABIN-10 and
 * external tickets group by their own prefix.
 */
export function compareTaskIds(a: string, b: string): number {
  const [prefixA, numberA] = splitTaskId(a);
  const [prefixB, numberB] = splitTaskId(b);
  if (prefixA !== prefixB) return prefixA.localeCompare(prefixB);
  return numberA - numberB || a.localeCompare(b);
}

/**
 * The task ID a branch names, chosen from `knownIds`.
 *
 * Only known IDs count: a branch like `fix/UTF-8-handling` names no task
 * unless UTF-8 is one. The match is case-insensitive and bounded on both
 * sides, so `ARCH-12` matches neither `ARCH-123` nor `XARCH-12`. When several
 * known IDs appear, the earliest in the branch wins.
 */
export function taskIdFromBranch(branch: string | null | undefined, knownIds: Iterable<string>): string | null {
  if (!branch) return null;
  const upper = branch.toUpperCase();

  let best: { id: string; index: number } | null = null;
  for (const known of knownIds) {
    const id = parseTaskId(known);
    if (!id) continue;
    const match = new RegExp(`(?<![A-Z0-9])${id}(?![0-9])`).exec(upper);
    if (!match) continue;
    if (!best || match.index < best.index || (match.index === best.index && id.length > best.id.length)) {
      best = { id, index: match.index };
    }
  }

  return best?.id ?? null;
}
