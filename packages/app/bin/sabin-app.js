#!/usr/bin/env node
// Launch the Sabin desktop app, detached, forwarding arguments
// (`sabin-app --task SABIN-0025`). The app is single-instance: a second
// launch focuses the running window and opens the task there.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const appDir = path.resolve(__dirname, '..');
const main = path.join(appDir, 'dist', 'main', 'main.js');

if (!fs.existsSync(main)) {
  console.error(`Sabin app is not built. Run: npm run build -w @sabin/app`);
  process.exit(1);
}

let electron;
try {
  // The electron package exports the path of its binary
  electron = require('electron');
} catch {
  console.error('Electron is not installed. Run npm install at the Sabin repository root.');
  process.exit(1);
}

// Chromium treats `--task X` as a switch and a stray positional argument;
// `--task=X` survives intact
const args = [];
const input = process.argv.slice(2);
for (let i = 0; i < input.length; i++) {
  if (input[i] === '--task' && input[i + 1] !== undefined) args.push(`--task=${input[++i]}`);
  else args.push(input[i]);
}

const child = spawn(electron, [appDir, ...args], {
  detached: true,
  stdio: 'ignore',
  env: process.env
});
child.on('error', error => {
  console.error(`Could not start the Sabin app: ${error.message}`);
  process.exit(1);
});
child.unref();
