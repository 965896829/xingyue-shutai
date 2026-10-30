import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { extractFile } from '@electron/asar';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const walk = root => fs.readdirSync(root, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(root, entry.name);
  return entry.isDirectory() ? walk(file) : [file];
});
const version = read('package.json').version;
const release = path.resolve('release/xingyue-v7');
const bundle = path.join(release, 'win-unpacked/resources');
const archive = path.join(bundle, 'app.asar');
assert.equal(JSON.parse(extractFile(archive, 'package.json').toString('utf8')).version, version);
let runtimeFiles = 0, resourceFiles = 0;
for (const root of ['dist', 'dist-electron']) for (const file of walk(root)) {
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
const testPath = process.argv[2] ?? '.test-output/xingyue-v7/platform-full.tap';
const tap = fs.readFileSync(testPath, 'utf8');
const count = label => Number(tap.match(new RegExp(`^# ${label} (\\d+)$`, 'm'))?.[1] ?? NaN);
assert.ok(count('tests') >= (process.argv[2] ? 1 : 880));
assert.equal(count('pass'), count('tests'));
for (const label of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(count(label), 0);
const installer = path.join(release, `星月书台 Setup ${version}.exe`);
const delivery = {
  createdAt: new Date().toISOString(), packageVersion: version, installer,
  bytes: fs.statSync(installer).size, sha256: digest(fs.readFileSync(installer)),
  runtimeFiles, resourceFiles, resourcesVerified: true, runtimeBundlesVerified: true,
  designSkills: catalog.designSkillCount, operations: catalog.operations.length,
  legacyMappings: catalog.legacyMapping.length,
  publishing: { options: read(path.join(bundle, 'skill/platform/fanqie.json')).options.length, observedDate: '2026-10-29', authorBackendVerified: false },
  regression: { scope: process.argv[2] ? 'targeted' : 'full', path: testPath, passed: count('pass'), durationMs: Number(tap.match(/^# duration_ms ([\d.]+)$/m)?.[1]) },
  paidModelCallsThisDelivery: 0,
  paidModelCallsTotal: read('.test-output/xingyue-v7/live-quality/budget.json').dispatched,
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
