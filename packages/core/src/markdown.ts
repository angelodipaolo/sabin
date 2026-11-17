import matter from 'gray-matter';

export interface Frontmatter {
  data: Record<string, unknown>;
  content: string;
}

/**
 * Split a markdown file into frontmatter and body.
 *
 * Passing options turns off gray-matter's parse cache, which hands back the
 * same `data` object for identical input - mutate it once and every later
 * parse of that text sees the change.
 */
export function parseFrontmatter(text: string): Frontmatter {
  const { data, content } = matter(text, {});
  return { data: { ...data }, content };
}

/** Frontmatter plus body, with undefined keys dropped */
export function stringifyFrontmatter(data: Record<string, unknown>, content: string): string {
  const clean = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));
  return matter.stringify(content, clean);
}

/**
 * A frontmatter date as YYYY-MM-DD. YAML reads an unquoted `2026-11-16` as a
 * Date, so both shapes come back here.
 */
export function asIsoDate(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return undefined;
}
