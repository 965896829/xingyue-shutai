import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const args = process.argv.slice(2);
const live = args.length === 3 && args.join(' ') === '--live --max-requests 24';
if (!live && args.length && !(args.length === 1 && args[0] === '--dry-run')) throw Error('使用 --dry-run 或 --live --max-requests 24');
const baseline = 'c43573c38e3f7aee56c63081fc97783b2f6826f5';
const root = path.resolve('.test-output/continuous-reading');
fs.mkdirSync(root, { recursive: true });
const scratch = fs.mkdtempSync(path.join(root, 'build-'));
const old = path.join(scratch, 'baseline');
fs.mkdirSync(old);
const archive = path.join(scratch, 'baseline.tar');
execFileSync('git', ['archive', '--format=tar', '--output', archive, baseline, 'src', 'package.json', 'resources/skill']);
execFileSync('tar', ['-xf', archive, '-C', old]);
const bundle = { platform: 'node', target: 'node24', bundle: true, format: 'cjs', external: ['electron'] };
await build({ ...bundle, entryPoints: [path.join(old, 'src/core/service.ts')], outfile: path.join(scratch, 'baseline.cjs') });
const entry = path.join(scratch, 'study.cjs');
await build({ ...bundle, entryPoints: ['scripts/reading-study.ts'], outfile: entry });
const out = live ? path.join(root, 'live') : fs.mkdtempSync(path.join(root, 'offline-'));
fs.mkdirSync(out, { recursive: true });
const binary = live ? createRequire(import.meta.url)('electron') : process.execPath;
const result = spawnSync(binary, [entry], { stdio: 'inherit', windowsHide: true, env: { ...process.env,
  STUDY_MODE: live ? 'live' : 'offline', STUDY_OUTPUT: out, STUDY_BASE: old, STUDY_COMMIT: baseline } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
