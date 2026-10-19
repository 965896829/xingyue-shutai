import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import ts from 'typescript';
import * as asar from '@electron/asar';

const base = '.test-output/workflow-20261011';
const source = JSON.parse(fs.readFileSync(path.join(base, 'source-audit.json'), 'utf8'));
const changedUI = source.ui.filter(row => !row.elementsAndLabelsUnchanged).map(row => row.file.replaceAll('\\', '/')).sort();
assert.deepEqual(changedUI, ['src/ui/App.tsx', 'src/ui/TagWorkspace.tsx']);
assert.ok(source.assets.every(row => row.unchanged));
assert.ok(source.comments.every(row => row.added === 0));
assert.deepEqual(source.architecture, []);
assert.deepEqual(source.package.piFiles, []);
assert.deepEqual(source.package.testSecrets, []);
assert.ok(source.package.bundles.every(row => row.matches));
const commentList = (file, text) => {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const comments = new Map();
  const visit = node => {
    for (const range of [...ts.getLeadingCommentRanges(text, node.pos) ?? [], ...ts.getTrailingCommentRanges(text, node.end) ?? []]) comments.set(range.pos, text.slice(range.pos, range.end));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...comments.values()];
};
const before = commentList('tags.test.ts', fs.readFileSync(path.join(base, 'tests_tags.test.ts'), 'utf8'));
const added = commentList('tags.test.ts', fs.readFileSync('tests/tags.test.ts', 'utf8')).filter(comment => {
  const at = before.indexOf(comment);
  if (at < 0) return true;
  before.splice(at, 1);
  return false;
});
assert.deepEqual(added, []);
const oldLock = JSON.parse(fs.readFileSync(path.join(base, 'package-lock.json'), 'utf8'));
const currentLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
currentLock.version = oldLock.version;
currentLock.packages[''].version = oldLock.packages[''].version;
assert.deepEqual(currentLock, oldLock);
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const archive = 'release/workflow/win-unpacked/resources/app.asar';
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const renderer = walk('dist').map(file => {
  const packaged = asar.extractFile(archive, path.normalize(file));
  const matches = digest(fs.readFileSync(file)) === digest(packaged);
  assert.equal(matches, true, file);
  return { file, matches };
});
const result = { scope: 'Workflow controls and copy intentionally changed in two existing components; visual style and all other component structures preserved', changedUI, unchangedUI: source.ui.length - changedUI.length, unchangedAssets: source.assets.length, newSourceComments: 0, newTestComments: added.length, dependenciesUnchanged: true, renderer, package: source.package };
fs.writeFileSync(path.join(base, 'review.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ changedUI, unchangedUI: result.unchangedUI, unchangedAssets: result.unchangedAssets, rendererFilesMatched: renderer.length }));
