import * as path from 'path';

/**
 * Give a bare name the default extension, but never override one the user
 * already chose.
 *
 * Notes hold any context an agent might read - JSON, YAML, CSV, logs - not
 * only markdown.
 */
export function noteFilename(name: string): string {
  const trimmed = name.trim();
  return path.extname(trimmed) ? trimmed : `${trimmed}.md`;
}

/**
 * Seed content for a new note. Only formats with an obvious empty form get
 * one; everything else starts empty rather than with a guess at its syntax.
 */
export function seedFor(filename: string): string {
  switch (path.extname(filename).toLowerCase()) {
    case '.md':
    case '.markdown':
      return `# ${path.basename(filename, path.extname(filename))}\n\n`;
    case '.json':
      return '{}\n';
    default:
      return '';
  }
}
