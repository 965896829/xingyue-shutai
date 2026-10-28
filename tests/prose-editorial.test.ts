import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { hash, prosePath, batchPath, activeBatch } from '../src/core/domain';
import { inspectProse, editorialReviewInput } from '../src/core/prose-editorial';
import { attachEditorial, chapterEditorial } from '../src/core/prose-editorial-context';
import { contextChanged, compileContext } from '../src/core/context-compiler';
import { contextBook, contextCase } from './fixtures/context-book';
import { fakeProfile } from './fixtures/refactor';
import { overlapParagraph, proseQualityCases } from './fixtures/prose-quality';
import { Service } from '../src/core/service';
import { RequestError } from '../src/core/provider';
import { fixture as documentFixture } from './fixtures/workflow';

const source = (text: string, file = prosePath(25)) => ({ path: file, hash: hash(text), content: text });
for (const fixture of proseQualityCases) test(`正文线索：${fixture.id}`, () => {
  const current = source(fixture.text), recent = (fixture.recent ?? []).map((text, i) => source(text, prosePath(i + 1)));
  const report = inspectProse(current, recent);
  assert.deepEqual([...new Set(report.findings.map(finding => finding.code))].sort(), [...fixture.signals].sort());
  for (const finding of report.findings) for (const evidence of finding.evidence) {
    const document = [current, ...recent].find(doc => doc.path === evidence.path)!;
    assert.equal(document.hash, evidence.hash);
    assert.equal(document.content.slice(evidence.start, evidence.end), evidence.quote, '每条线索均能定位到精确原文');
  }
});

test('诊断绑定版本，不输出 AI 概率、放行结论或硬错误；必要回顾交给审稿判断', () => {
  const current = source(overlapParagraph);
  assert.throws(() => inspectProse({ ...current, hash: 'stale' }), /版本/);
  assert.throws(() => inspectProse(current, [{ ...source('旧文'), hash: 'stale' }]), /版本/);
  const report = inspectProse(current, [source(overlapParagraph, prosePath(24))]);
  assert.match(editorialReviewInput(report).policy, /有意复沓.*回忆/);
  assert.ok(!('issues' in report) && !('passed' in report) && !('aiScore' in report));
});

test('可选诊断超限时只减少线索，不删正文与作者规则，不产生阻断', () => {
  const report = inspectProse(source(overlapParagraph + '\n' + overlapParagraph), [source(overlapParagraph, prosePath(24))]);
  const input = { prose: overlapParagraph, authorRules: ['这是作者必须保留的规则'] };
  const omitted = attachEditorial(input, report, () => false);
  assert.equal(omitted.input, input); assert.equal(omitted.omitted, report.findings.length);
  assert.deepEqual(omitted.references, []);
  const included = attachEditorial(input, report, () => true);
  assert.ok(included.included > 0);
  assert.deepEqual(included.input.prose, input.prose);
  assert.deepEqual(included.input.authorRules, input.authorRules);
  assert.deepEqual(included.references, [{ path: prosePath(24), hash: hash(overlapParagraph), reason: 'editorial-comparison' }]);
});

test('多字节字符证据不会截断码点，偏移能直接定位编辑器文本', () => {
  const line = '𠮷' + '这段文字用于测量证据偏移和长段落截断，并不是真正的小说。'.repeat(10);
  const text = '\r\n' + line + '\r\n\r\n' + line;
  const report = inspectProse(source(text));
  assert.equal(report.findings[0].code, 'repeated_paragraph');
  for (const evidence of report.findings[0].evidence) {
    assert.equal(text.slice(evidence.start, evidence.end), evidence.quote);
    assert.equal(Array.from(evidence.quote).length, 160);
    assert.ok(!/[\uD800-\uDBFF]$/.test(evidence.quote));
  }
});

test('兼容保留 UTF-8 BOM 的旧稿版本，不能把解码差异误报成版本变化', () => {
  const decoded = overlapParagraph, originalHash = hash('\uFEFF' + decoded);
  const report = inspectProse(source(decoded), [{ path: prosePath(24), content: decoded, hash: originalHash }]);
  const prior = report.findings[0].evidence[1];
  assert.equal(prior.hash, originalHash);
  assert.equal(decoded.slice(prior.start, prior.end), prior.quote);
  assert.throws(() => inspectProse(source(decoded), [{ path: prosePath(24), content: decoded + '改动', hash: originalHash }]), /版本/);
});

test('本地跨章对照只读已确认前文，未确认外部改动不进入审稿提示', () => {
  const book = contextBook(false);
  try {
    const project = structuredClone(book.project); project.revision++; project.chapters[23] = 'complete';
    book.store.commit([{ path: prosePath(23), content: overlapParagraph, baseHash: null }], project);
    const manifest = compileContext(book.store, project, 'S10', contextCase.request, fakeProfile);
    // The optional retrieval excerpt may be evicted by the model's input budget.
    assert.ok(!manifest.sources.find(source => source.path === prosePath(23))?.required);
    manifest.sources = manifest.sources.filter(source => source.path !== prosePath(23));
    const current = source(overlapParagraph);
    const report = chapterEditorial(book.store, project, manifest, current);
    assert.deepEqual(report.compared.map(doc => doc.path), [prosePath(23), prosePath(24)]);
    const attached = attachEditorial({ prose: current }, report, () => true);
    manifest.referenceSources = attached.references;
    assert.ok(attached.references.some(doc => doc.path === prosePath(23)));
    assert.equal(contextChanged(book.store, manifest), false);
    fs.appendFileSync(path.join(book.root, prosePath(23)), '\n未确认的新版本');
    assert.equal(contextChanged(book.store, manifest), true);
    assert.deepEqual(chapterEditorial(book.store, project, manifest, current).compared.map(doc => doc.path), [prosePath(24)]);
  } finally { book.store.close(); }
});

test('人物视角不借跨章诊断读入视角之外的正文', () => {
  const book = contextBook(true);
  try {
    const manifest = compileContext(book.store, book.project, 'S10', contextCase.request, fakeProfile);
    const report = chapterEditorial(book.store, book.project, manifest, source(overlapParagraph));
    assert.deepEqual(report.compared, []);
  } finally { book.store.close(); }
});

test('已完成审稿的来源版本在记忆阶段恢复时仍保留，未知请求不会自动重发', async () => {
  const book = contextBook(false), root = book.root;
  book.store.close();
  let calls = 0, service: Service;
  service = new Service(path.resolve('resources/skill'), () => {}, async () => {
    calls++;
    const current = service.store!.db.runs().find(run => run.status === 'running')!;
    assert.equal(current.manifest!.referenceSources?.[0].path, prosePath(1));
    throw new RequestError('合成断流：未调用真实服务', true);
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000 }];
  try {
    await service.invoke('project.open', { root });
    const p = service.store!.db.project(); p.revision++;
    service.store!.commit([service.change(batchPath(activeBatch(p)), documentFixture(p, batchPath(activeBatch(p)), service))], p);
    const run = service.makeRun('stage', contextCase.request);
    const prose = source(overlapParagraph);
    run.pipeline!.phase = 'memory'; run.pipeline!.proseHash = prose.hash;
    run.changes = [{ path: prose.path, content: prose.content, baseHash: null }];
    run.manifest = compileContext(service.store!, p, 'S10', run.request, service.profiles[0]);
    run.manifest.referenceSources = [{ path: prosePath(1), hash: service.store!.readAccepted(prosePath(1)).hash, reason: 'editorial-comparison' }];
    service.store!.db.saveRun(run);
    await service.runner!.drive(run.id);
    const interrupted = service.store!.db.run(run.id);
    assert.equal(calls, 1, interrupted.error ?? '');
    assert.equal(interrupted.status, 'unknown');
    assert.deepEqual(interrupted.manifest!.referenceSources, run.manifest.referenceSources);
  } finally { await service.drain(); }
});
