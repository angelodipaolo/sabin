import fs from 'fs';
import os from 'os';
import path from 'path';

// Every core function takes the home explicitly, but anything that ever
// falls back to resolveHome() must land somewhere disposable
process.env.SABIN_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'sabin-jest-home-'));
// Never let a test inherit the iTerm2 session of the terminal running jest
delete process.env.ITERM_SESSION_ID;
delete process.env.TERM_PROGRAM;
