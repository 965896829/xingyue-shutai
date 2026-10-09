import { build } from 'esbuild';
await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/worker.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info'
});
