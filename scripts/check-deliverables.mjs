import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const releaseRoot = process.env.WENXU_RELEASE_DIR ?? 'release';
const docs = fs.readdirSync('docs').filter((f) => f.endsWith('.md'));
const broken = [];
for (const name of docs) {
  const file = path.join('docs', name),
    content = fs.readFileSync(file, 'utf8');
  for (const match of content.matchAll(/\]\(([^)\n]+)\)/g)) {
    const link = match[1].replace(/^<|>$/g, '').split('#')[0];
    if (!link || /^(https?:|app:|codex:|mailto:)/i.test(link)) continue;
    const target = decodeURIComponent(link).replace(/:\d+$/, '');
    if (!fs.existsSync(path.isAbsolute(target) ? target : path.resolve('docs', target)))
      broken.push({ file, link });
  }
}
assert.deepEqual(broken, [], 'Broken documentation links');
const ids = (file) => [...fs.readFileSync(file, 'utf8').matchAll(/^\| (REQ-[A-Z]\d+) \|/gm)].map((m) => m[1]);
assert.deepEqual(ids('docs/15_逐项实施与验收状态.md'), ids('docs/04_功能追溯矩阵.md'));
assert.equal(ids('docs/15_逐项实施与验收状态.md').length, 180);
const filesIn = (root, relative = '') =>
  fs
    .readdirSync(path.join(root, relative), { withFileTypes: true })
    .flatMap((entry) => {
      const name = path.posix.join(relative, entry.name);
      assert.ok(!entry.isSymbolicLink(), `Linked resource is not permitted: ${name}`);
      if (entry.isDirectory()) return filesIn(root, name);
      assert.ok(entry.isFile(), `Resource is not a regular file: ${name}`);
      return [name];
    })
    .sort();
const resourceFile = (root, relative) => {
  assert.ok(typeof relative === 'string' && relative && !path.isAbsolute(relative));
  const file = path.resolve(root, relative),
    within = path.relative(path.resolve(root), file);
  assert.ok(within && !within.startsWith('..') && !path.isAbsolute(within), 'Resource escaped its directory');
  return file;
};
const source = 'resources/skill',
  packaged = path.join(releaseRoot, 'win-unpacked/resources/skill');
const skillFiles = filesIn(source);
assert.deepEqual(filesIn(packaged), skillFiles, 'Packaged Skill file inventory differs from source');
for (const file of skillFiles)
  assert.equal(
    sha(resourceFile(packaged, file)),
    sha(resourceFile(source, file)),
    `Packaged Skill mismatch: ${file}`
  );

const runtimeRoot = path.join(source, 'runtime');
const runtimeLock = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'resources.lock.json'), 'utf8'));
const runtimeFiles = Object.keys(runtimeLock).sort();
assert.deepEqual(
  filesIn(runtimeRoot).filter((file) => file !== 'resources.lock.json'),
  runtimeFiles,
  'Runtime resource lock coverage differs'
);
for (const [file, digest] of Object.entries(runtimeLock)) {
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(sha(resourceFile(runtimeRoot, file)), digest, `Runtime lock mismatch: ${file}`);
}
const registry = JSON.parse(fs.readFileSync(path.join(runtimeRoot, 'skills.registry.json'), 'utf8'));
assert.equal(registry.skills.length, 26);
assert.equal(new Set(registry.skills.map((skill) => skill.id)).size, registry.skills.length);
for (const skill of registry.skills) {
  assert.equal(runtimeLock[skill.path], skill.sha256, `Skill registry digest mismatch: ${skill.id}`);
  assert.ok(runtimeLock[skill.contract], `Skill contract is not locked: ${skill.id}`);
}

const expressionRoot = path.join(source, 'expression');
const expressionManifest = JSON.parse(fs.readFileSync(path.join(expressionRoot, 'manifest.json'), 'utf8'));
assert.deepEqual(
  filesIn(expressionRoot).filter((file) => file !== 'manifest.json'),
  Object.keys(expressionManifest.files).sort(),
  'Expression manifest coverage differs'
);
for (const [file, digest] of Object.entries(expressionManifest.files)) {
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.equal(sha(resourceFile(expressionRoot, file)), digest, `Expression manifest mismatch: ${file}`);
}
const expression = JSON.parse(fs.readFileSync(path.join(expressionRoot, 'rules_master.json'), 'utf8'));
assert.equal(expression.version, expressionManifest.version);
assert.equal(expression.rules.length, expressionManifest.ruleCount);
assert.equal(new Set(expression.rules.map((rule) => rule.id)).size, expressionManifest.ruleCount);
assert.equal(new Set(expression.rules.map((rule) => rule.module_id)).size, expressionManifest.moduleCount);
assert.equal(expressionManifest.ruleCount, 905);
assert.equal(expressionManifest.moduleCount, 145);

const tagRoot = path.join(source, 'tags');
const tagLock = JSON.parse(fs.readFileSync(path.join(tagRoot, 'resources.lock.json'), 'utf8'));
assert.deepEqual(
  filesIn(tagRoot).filter((file) => file !== 'resources.lock.json'),
  Object.keys(tagLock).sort(),
  'Tag resource lock coverage differs'
);
for (const [file, digest] of Object.entries(tagLock))
  assert.equal(sha(resourceFile(tagRoot, file)), digest, `Tag resource mismatch: ${file}`);
const taxonomy = JSON.parse(fs.readFileSync(path.join(tagRoot, 'registry/taxonomy.json'), 'utf8'));
assert.equal(taxonomy.options.length, 482);
assert.equal(new Set(taxonomy.options.map((o) => o.id)).size, 482);

const testLog = process.argv[2] ?? '.test-output/tag-upgrade/tests.log';
const tests = fs.readFileSync(testLog, 'utf8');
// Node chooses TAP or the spec reporter depending on its output stream.
const total = Number(tests.match(/(?:#|ℹ) tests (\d+)\r?\n/)?.[1]);
assert.ok(total >= 143, 'Current release regression log is incomplete');
assert.equal(Number(tests.match(/(?:#|ℹ) pass (\d+)\r?\n/)?.[1]), total);
assert.match(tests, /(?:#|ℹ) fail 0\r?\n/);
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.ok(
  fs.existsSync(path.join(releaseRoot, `win-unpacked/${pkg.build.win.executableName}.exe`)),
  'Packaged executable name differs'
);
assert.ok(!fs.existsSync(path.join(releaseRoot, 'win-unpacked/文序.exe')), 'Obsolete executable remains in current build');
const version = pkg.version;
const installer = path.join(releaseRoot, `${pkg.build.productName} Setup ${version}.exe`);
const report = {
  at: new Date().toISOString(),
  docs: docs.length,
  brokenLinks: broken,
  requirementIds: 180,
  skillFilesByteExact: skillFiles.length,
  skills: {
    source,
    packaged,
    runtimeLockedFiles: runtimeFiles.length,
    registeredSkills: registry.skills.length,
    runtimeLockSha256: sha(path.join(runtimeRoot, 'resources.lock.json')),
    expressionLockedFiles: Object.keys(expressionManifest.files).length,
    expressionRules: expressionManifest.ruleCount,
    expressionModules: expressionManifest.moduleCount,
    tagOptions: taxonomy.options.length,
    taxonomyVersion: taxonomy.taxonomyVersion,
    tagLockedFiles: Object.keys(tagLock).length,
    tagLockSha256: sha(path.join(tagRoot, 'resources.lock.json')),
    expressionManifestSha256: sha(path.join(expressionRoot, 'manifest.json'))
  },
  testLog: { path: testLog, sha256: sha(testLog) },
  tests: total,
  failures: 0,
  installer: { path: installer, bytes: fs.statSync(installer).size, sha256: sha(installer) },
  buildInputs: {
    lockfile: sha('package-lock.json'),
    main: sha('dist-electron/main.cjs'),
    worker: sha('dist-electron/worker.cjs')
  },
  note: '文档和构建完整性检查，不能替代未完成的真实端点、文学效果与操作系统矩阵验收'
};
fs.writeFileSync('.test-output/delivery-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
