import { build } from 'esbuild';
import { verifyBundledDependencies } from './bundle-dependencies.mjs';
import { execFileSync } from 'node:child_process';
function git(args, fallback) {
  try { return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback; }
  catch { return fallback; }
}
const buildIdentity = {
  time: new Date().toISOString(),
  branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || git(['branch', '--show-current'], '源码快照'),
  commit: git(['rev-parse', '--short=12', 'HEAD'], process.env.GITHUB_SHA?.slice(0, 12) || '未知')
};
const result = await build({
  entryPoints: ['electron/main.ts', 'electron/preload.ts', 'electron/worker.ts', 'electron/document-worker.ts'],
  bundle: true,
  define: { __WRITING_DESK_BUILD__: JSON.stringify(buildIdentity) },
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
// The development server serves the renderer from source. Release checks use Vite's built assets.
if (import.meta.main) verifyBundledDependencies(result.metafile);
