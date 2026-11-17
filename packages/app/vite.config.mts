import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import preact from '@preact/preset-vite';

const root = fileURLToPath(new URL('./src/renderer', import.meta.url));

/**
 * The built page gets a strict Content Security Policy: scripts only from the
 * app itself, no network at all, no frames, no plugins. Agent messages are
 * rendered as markdown, so this is the backstop behind DOMPurify. Styles
 * allow 'unsafe-inline' because CodeMirror injects its own style elements.
 * Not applied to the dev server, which needs inline scripts and a websocket.
 */
function csp(): Plugin {
  return {
    name: 'sabin-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
        match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`
      );
      const policy = [
        "default-src 'none'",
        `script-src 'self' ${hashes.join(' ')}`.trim(),
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'"
      ].join('; ');
      return html.replace('<meta charset="utf-8" />', `<meta charset="utf-8" />\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
    }
  };
}

export default defineConfig({
  root,
  base: './',
  plugins: [preact(), csp()],
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
    target: 'chrome140',
    chunkSizeWarningLimit: 1200
  }
});
