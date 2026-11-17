// Development: Vite serves the renderer with hot reload, esbuild watches the
// main process and preload, and Electron loads the Vite URL. Restart the
// command after changing main-process code.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const require = createRequire(import.meta.url);

await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, ['scripts/build-main.mjs'], { cwd: root, stdio: 'inherit' });
  child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`build-main exited ${code}`))));
});
spawn(process.execPath, ['scripts/build-main.mjs', '--watch'], { cwd: root, stdio: 'inherit' });

const server = await createServer({ configFile: `${root}vite.config.mts`, server: { port: 5199, strictPort: false } });
await server.listen();
const url = server.resolvedUrls.local[0];

const electron = spawn(require('electron'), [root, ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SABIN_APP_DEV_URL: url, SABIN_APP_USER_DATA: process.env.SABIN_APP_USER_DATA ?? `${root}.dev-profile` }
});
electron.on('exit', code => {
  void server.close();
  process.exit(code ?? 0);
});
