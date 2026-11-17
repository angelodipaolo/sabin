/**
 * Fuzzy matching for the quick switcher: every query character must appear in
 * order. Scores reward contiguous runs, word starts and an early first match,
 * so "cc" ranks "Command center" above "accounts receivable check".
 */

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1];
  return /[\s\-_/.·:]/.test(previous) || (/[a-z]/.test(previous) && /[A-Z]/.test(text[index]));
}

/** A score (higher is better) or null when `query` is not a subsequence of `text` */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  const lower = text.toLowerCase();

  // A plain substring always beats a scattered match
  const direct = lower.indexOf(q);
  if (direct !== -1) {
    return 1000 + q.length * 10 - direct + (isBoundary(text, direct) ? 100 : 0);
  }

  let score = 0;
  let from = 0;
  let previous = -2;
  for (const char of q) {
    const index = lower.indexOf(char, from);
    if (index === -1) return null;
    if (index === previous + 1) score += 15;
    if (isBoundary(text, index)) score += 10;
    score -= Math.min(index - from, 10);
    previous = index;
    from = index + 1;
  }
  return score;
}

export interface FuzzyResult<T> {
  item: T;
  score: number;
}

/**
 * Items whose fields match the query, best first. Each query word must match
 * some field, so "sab rev" finds a SABIN task in review. Stable for equal scores.
 */
export function fuzzyFilter<T>(items: T[], query: string, fields: (item: T) => string[]): FuzzyResult<T>[] {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return items.map(item => ({ item, score: 0 }));

  const results: (FuzzyResult<T> & { index: number })[] = [];
  items.forEach((item, index) => {
    const haystacks = fields(item).filter(Boolean);
    let total = 0;
    for (const word of words) {
      let best: number | null = null;
      for (const haystack of haystacks) {
        const score = fuzzyScore(word, haystack);
        if (score !== null && (best === null || score > best)) best = score;
      }
      if (best === null) return;
      total += best;
    }
    results.push({ item, score: total, index });
  });

  return results
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item, score }) => ({ item, score }));
}
