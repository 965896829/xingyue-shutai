import { build } from 'esbuild';
import { verifyBundledDependencies } from './bundle-dependencies.mjs';
const result = await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/worker.ts', 'electron/document-worker.ts'],
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'cjs',
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  external: ['electron'],
  sourcemap: true,
  metafile: true,
  logLevel: 'info'
});
verifyBundledDependencies(result.metafile);
