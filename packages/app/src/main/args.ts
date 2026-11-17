/**
 * `--task <ID>` or `--task=<ID>` from a launch's argv, uppercased. Anything
 * that is not shaped like an ID is ignored rather than opened.
 */
export function taskFromArgv(argv: readonly string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    let value: string | undefined;
    if (arg === '--task') value = argv[i + 1];
    else if (arg.startsWith('--task=')) value = arg.slice('--task='.length);
    if (value === undefined) continue;
    const id = value.trim().toUpperCase();
    if (/^[A-Z][A-Z0-9]*-\d+$/.test(id)) return id;
  }
  return null;
}
