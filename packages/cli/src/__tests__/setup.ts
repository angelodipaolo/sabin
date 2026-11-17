import fs from 'fs';
import os from 'os';
import path from 'path';
import chalk from 'chalk';

// Every path the CLI derives from the environment lands somewhere disposable,
// even before a test's own beforeEach runs. Tests replace these per test.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabin-cli-jest-'));
process.env.HOME = root;
process.env.SABIN_HOME = path.join(root, 'sabin');
process.env.CLAUDE_CONFIG_DIR = path.join(root, '.claude');
process.env.CODEX_HOME = path.join(root, '.codex');
// Never inherit the iTerm2 session of the terminal running jest
delete process.env.ITERM_SESSION_ID;
delete process.env.TERM_PROGRAM;

chalk.level = 0;
