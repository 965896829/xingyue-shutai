import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export default defineConfig(({ command }) => {
  const nonce = randomBytes(24).toString('base64');
  return {
    resolve: { alias: { '@reference': fileURLToPath(new URL('./src/admin/reference', import.meta.url)) } },
    plugins: [
      react(),
      {
        name: 'development-csp',
        transformIndexHtml(html) {
          return command === 'serve'
            ? html.replace("script-src 'self'", `script-src 'self' 'nonce-${nonce}'`)
            : html;
        }
      }
    ],
    html: command === 'serve' ? { cspNonce: nonce } : undefined,
    base: './',
    optimizeDeps: { entries: ['index.html', 'admin.html'] },
    server: { host: '127.0.0.1', port: 5173, strictPort: true, watch: { ignored: ['**/.test-output/**', '**/release/**'] } },
    build: { sourcemap: true, rolldownOptions: { input: ['index.html', 'admin.html'] } }
  };
});
