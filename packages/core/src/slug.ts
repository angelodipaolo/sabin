/** Filler words that carry no meaning in a branch or directory name */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
  'in', 'into', 'is', 'it', 'of', 'on', 'or', 'per', 'that', 'the', 'this',
  'to', 'via', 'with'
]);

export const SLUG_MAX_LENGTH = 32;

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean);
}

/**
 * The branch and worktree suffix for a title: lowercase, stop words dropped,
 * capped at 32 characters on a word boundary. Null when the title yields
 * nothing usable.
 *
 * Computed, never stored: once a worktree exists its branch is the record.
 */
export function slugFromTitle(title: string): string | null {
  const all = words(title ?? '');
  if (all.length === 0) return null;

  // Fall back to every word when stripping would leave nothing
  const stripped = all.filter(word => !STOP_WORDS.has(word));
  const source = stripped.length > 0 ? stripped : all;

  const kept: string[] = [];
  let length = 0;
  for (const word of source) {
    const cost = kept.length === 0 ? word.length : word.length + 1;
    if (length + cost > SLUG_MAX_LENGTH) break;
    kept.push(word);
    length += cost;
  }

  // A single oversized word still produces something
  return kept.length > 0 ? kept.join('-') : source[0].slice(0, SLUG_MAX_LENGTH);
}

/**
 * A project slug from what a person typed: "Sabin App" -> "sabin-app".
 * Null when nothing usable is left. The result is always a safe filename.
 */
export function parseProjectSlug(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const slug = words(input).join('-');
  return slug || null;
}
