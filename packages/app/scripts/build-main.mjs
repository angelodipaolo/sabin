// Bundles the main process and the preload with esbuild. @sabin/core and its
// dependencies are bundled in, so the packaged app needs no node_modules.
import { build, context } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: true,
  external: ['electron'],
  absWorkingDir: root,
  logLevel: 'warning'
};

const targets = [
  { ...shared, entryPoints: ['src/main/main.ts'], outfile: 'dist/main/main.js' },
  // Sandboxed preloads can only require('electron'), so this bundle must stand alone
  { ...shared, entryPoints: ['src/preload/preload.ts'], outfile: 'dist/preload/preload.js' }
];

if (watch) {
  for (const options of targets) await (await context(options)).watch();
  console.log('esbuild: watching main and preload');
} else {
  await Promise.all(targets.map(options => build(options)));
}
