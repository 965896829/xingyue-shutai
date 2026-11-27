import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { extractFile } from '@electron/asar';
import { desktopArtifacts } from './desktop-artifacts.mjs';

const testPath = process.argv[2];
assert.ok(testPath, '请指定本次测试日志：node scripts/verify-v7-release.mjs <测试日志路径>');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const walk = root => fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(root, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const version = read('package.json').version;
const { resources: bundle, installer } = desktopArtifacts();
const archive = path.join(bundle, 'app.asar');
assert.equal(JSON.parse(extractFile(archive, 'package.json').toString('utf8')).version, version);
let runtimeFiles = 0, resourceFiles = 0;
for (const root of ['dist', 'dist-electron']) for (const file of walk(root).filter(file => !file.endsWith('.map'))) {
  assert.ok(extractFile(archive, path.normalize(file)).equals(fs.readFileSync(file)), `程序文件不一致：${file}`);
  runtimeFiles++;
}
for (const file of walk('resources/skill')) {
  const relative = path.relative('resources/skill', file);
  assert.ok(fs.readFileSync(path.join(bundle, 'skill', relative)).equals(fs.readFileSync(file)), `资源不一致：${relative}`);
  resourceFiles++;
}
for (const folder of ['creative-v7', 'design-v7', 'platform']) {
  const root = path.join(bundle, 'skill', folder);
  for (const [file, sha] of Object.entries(read(path.join(root, 'resources.lock.json'))))
    assert.equal(digest(fs.readFileSync(path.join(root, file))), sha, `资源锁不一致：${folder}/${file}`);
}
const catalog = read(path.join(bundle, 'skill/creative-v7/catalog.json'));
assert.equal(catalog.operations.length, 48);
assert.ok(catalog.operations.every(operation => operation.active));
const tap = fs.readFileSync(testPath, 'utf8');
const count = label => Number(tap.match(new RegExp(`^(?:#|ℹ) ${label} (\\d+)\\r?$`, 'm'))?.[1] ?? NaN);
assert.ok(count('tests') >= 1);
assert.equal(count('pass'), count('tests'));
for (const label of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(count(label), 0);
const budget = '.test-output/xingyue-v7/live-quality/budget.json';
const delivery = {
  createdAt: new Date().toISOString(), packageVersion: version, installer,
  bytes: fs.statSync(installer).size, sha256: digest(fs.readFileSync(installer)),
  runtimeFiles, resourceFiles, resourcesVerified: true, runtimeBundlesVerified: true,
  designSkills: catalog.designSkillCount, operations: catalog.operations.length,
  legacyMappings: catalog.legacyMapping.length,
  publishing: { options: read(path.join(bundle, 'skill/platform/fanqie.json')).options.length, observedDate: '2026-10-29', authorBackendVerified: false },
  regression: { scope: 'targeted', path: testPath, passed: count('pass'), durationMs: Number(tap.match(/^(?:#|ℹ) duration_ms ([\d.]+)\r?$/m)?.[1]) },
  paidModelCallsByVerifier: 0,
  paidModelCallsThisDelivery: null,
  paidModelCallsTotal: fs.existsSync(budget) ? read(budget).dispatched : null,
  externalAcceptance: { humanBlindReview: 'not_run', realLongNovel: 'not_run', platformOutcome: 'not_run' }
};
fs.mkdirSync('output/xingyue-v7', { recursive: true });
const latest = 'output/xingyue-v7/delivery.json';
if (fs.existsSync(latest)) {
  const prior = read(latest), historical = `output/xingyue-v7/delivery-${prior.packageVersion}.json`;
  if (!fs.existsSync(historical)) fs.copyFileSync(latest, historical);
}
fs.writeFileSync(`output/xingyue-v7/delivery-${version}.json`, JSON.stringify(delivery, null, 2) + '\n');
fs.writeFileSync(latest, JSON.stringify(delivery, null, 2) + '\n');
console.log(JSON.stringify(delivery));
