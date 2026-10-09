import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { randomBytes } from 'node:crypto';
export default defineConfig(({ command }) => {
  const nonce = randomBytes(24).toString('base64');
  return {
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
    server: { host: '127.0.0.1', port: 5173, strictPort: true },
    build: { sourcemap: true }
  };
});
