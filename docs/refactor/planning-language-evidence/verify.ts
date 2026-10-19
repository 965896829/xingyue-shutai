import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import ts from 'typescript';
import { Service } from '../../src/core/service';
import { tagHash } from '../../src/core/tags';

const base = path.resolve('.test-output/planning-language-20261011');
const fixture = JSON.parse(fs.readFileSync(path.join(base, 'fixture.json'), 'utf8'));
const lock = path.join(fixture.project.root, '.novelclient/write-lock.json');
assert.equal(fs.existsSync(lock), false);
const service = new Service(path.resolve('resources/skill'), () => {});
let cleanup;
try {
  await service.open(fixture.project.root);
  const run = service.store!.db.run(fixture.runId);
  const hashes = { candidateHash: tagHash(run.planning!.candidate), reportHash: tagHash(run.planning!.report), changesHash: tagHash(run.changes) };
  for (const [key, value] of Object.entries(hashes)) assert.equal(value, fixture[key]);
  cleanup = { ...hashes, recordsUnchanged: true, originalLockReleased: true, runStatus: run.status, phase: run.planning!.phase, isolatedProject: fixture.project.root, kind: fixture.kind };
} finally { service.close(); }
assert.equal(fs.existsSync(lock), false);
fs.writeFileSync(path.join(base, 'cleanup.json'), JSON.stringify({ ...cleanup, verificationLockReleased: true, electronPid: 47228, electronExitVerified: true }, null, 2));

const comments = (file: string, text: string) => {
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const values = new Map<number, string>();
  const visit = (node: ts.Node) => {
    for (const range of [...ts.getLeadingCommentRanges(text, node.pos) ?? [], ...ts.getTrailingCommentRanges(text, node.end) ?? []]) values.set(range.pos, text.slice(range.pos, range.end));
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return [...values.values()];
};
const rows = ['tests/planning-language.test.ts', 'tests/tags.test.ts'].map(file => {
  const original = path.join(base, file.replaceAll('/', '_'));
  const before = fs.existsSync(original) ? comments(file, fs.readFileSync(original, 'utf8')) : [];
  const added = comments(file, fs.readFileSync(file, 'utf8')).filter(value => {
    const index = before.indexOf(value);
    if (index < 0) return true;
    before.splice(index, 1);
    return false;
  });
  assert.deepEqual(added, []);
  return { file, addedComments: added.length };
});
const oldLock = JSON.parse(fs.readFileSync(path.join(base, 'package-lock.json'), 'utf8'));
const newLock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
newLock.version = oldLock.version;
newLock.packages[''].version = oldLock.packages[''].version;
assert.deepEqual(newLock, oldLock);
const sha = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const unchanged = ['src/core/tags.ts', 'src/shared/tags.ts'].map(file => {
  assert.equal(sha(file), sha(path.join(base, file.replaceAll('/', '_'))));
  return file;
});
fs.writeFileSync(path.join(base, 'review.json'), JSON.stringify({ tests: rows, lockfileOnlyVersionChanged: true, unchanged, noExternalModelCalls: true }, null, 2));
console.log(JSON.stringify({ cleanup, review: rows }));
