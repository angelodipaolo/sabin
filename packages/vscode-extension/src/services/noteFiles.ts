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
 * The name a note will actually land under.
 *
 * Directories keep whatever they were given - `noteFilename` would turn a
 * `transcripts` folder into `transcripts.md` on rename.
 */
export function noteTargetName(name: string, isDirectory: boolean): string {
  const trimmed = name.trim();
  return isDirectory ? trimmed : noteFilename(trimmed);
}

/**
 * Why a name cannot be used, or nothing.
 *
 * Fed to `showInputBox`'s `validateInput`, so a collision is refused while the
 * user is still typing rather than after `fs.rename` has already failed.
 * Comparison is case-insensitive because the filesystem this runs on usually
 * is: `Plan.md` and `plan.md` are the same file on a Mac.
 */
export function validateNoteName(
  name: string,
  existing: string[] = [],
  isDirectory = false
): string | undefined {
  const trimmed = name.trim();

  if (trimmed.length === 0) return 'Give the note a name';
  if (/[/\\]/.test(trimmed)) return 'Notes cannot contain a path separator';
  if (trimmed === '.' || trimmed === '..') return 'That is not a name';

  const target = noteTargetName(trimmed, isDirectory);
  if (existing.some(entry => entry.toLowerCase() === target.toLowerCase())) {
    return `A file named ${target} already exists`;
  }

  return undefined;
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
