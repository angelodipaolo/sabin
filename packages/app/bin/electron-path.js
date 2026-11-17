// macOS takes the Dock and application menu names from the bundle, even
// after app.setName(). Keep a named copy of the development runtime in a
// cache; never edit the installed Electron bundle shared by other apps.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function electronPath() {
  const executable = require('electron');
  if (process.platform !== 'darwin') return executable;

  const source = path.resolve(executable, '../../..');
  const version = require('electron/package.json').version;
  const parent = path.resolve(__dirname, '../node_modules/.cache/sabin');
  const cache = path.join(parent, `${version}-${process.arch}-named-v1`);
  const ready = path.join(cache, 'ready');
  if (!fs.existsSync(ready)) {
    fs.mkdirSync(parent, { recursive: true });
    const staging = fs.mkdtempSync(path.join(parent, 'runtime-'));
    try {
      const bundle = path.join(staging, 'Sabin.app');
      fs.cpSync(source, bundle, { recursive: true, verbatimSymlinks: true, mode: fs.constants.COPYFILE_FICLONE });
      const plist = path.join(bundle, 'Contents/Info.plist');
      for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
        execFileSync('/usr/bin/plutil', ['-replace', key, '-string', 'Sabin', plist]);
      }
      execFileSync('/usr/bin/plutil', ['-replace', 'CFBundleIdentifier', '-string', 'dev.sabin.runtime', plist]);
      execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'pipe' });
      fs.writeFileSync(path.join(staging, 'ready'), '');
      try {
        fs.renameSync(staging, cache);
      } catch (error) {
        // Another launcher may have finished the same runtime first.
        if (!fs.existsSync(ready)) throw error;
      }
    } finally {
      fs.rmSync(staging, { recursive: true, force: true });
    }
  }
  return path.join(cache, 'Sabin.app/Contents/MacOS/Electron');
}

module.exports = { electronPath };
