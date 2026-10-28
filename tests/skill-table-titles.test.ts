import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeCandidate } from '../src/core/output-normalization';
import { authorStructureIssues } from '../src/core/skill-output-contract';
import { paths, hash } from '../src/core/domain';
import { prepareDocumentDrafts } from '../src/core/runtime/document-drafts';
import type { Run } from '../src/shared/types';

const cases = [
  { path: paths.outline, fixture: 'death-right-roadmap-041.md', title: '章节总纲' },
  { path: '05_长篇大纲/第001-030章节奏.md', fixture: 'death-right-rhythm-041.md', title: '第001-030章节奏' }
];

test('真实无标题输出本地补全原模板H1，叙事单元格逐字保留且不增加请求', () => {
  for (const item of cases) for (const newline of ['\n', '\r\n']) {
    const content = fs.readFileSync(new URL(`./fixtures/${item.fixture}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n').replaceAll('\n', newline);
    const change = { path: item.path, content, baseHash: 'accepted-base' };
    assert.ok(authorStructureIssues(change).some(i => i.code === 'template_document_title'));
    const fixed = normalizeCandidate(change);
    assert.equal(fixed.change.content, `# ${item.title}${newline}${newline}${content}`);
    assert.deepEqual(authorStructureIssues(fixed.change), []);
    assert.equal(fixed.change.baseHash, change.baseHash);
    assert.deepEqual(normalizeCandidate(fixed.change), { change: fixed.change, edits: [] });
  }
});

test('标题只对完整可识别表格补全，残行、围栏、非目标文件及现有标题不被猜改', () => {
  const content = fs.readFileSync(new URL('./fixtures/death-right-roadmap-041.md', import.meta.url), 'utf8');
  const unchanged = [
    { path: paths.outline, content: '```markdown\n' + content + '\n```' },
    { path: paths.outline, content: content.split('\n').slice(0, 2).join('\n') },
    { path: paths.outline, content: content.replace(/\| 001 .*\|/, '| 001 | 缺列 |') },
    { path: paths.outline, content: '# 作者给出的标题\n\n' + content },
    { path: paths.outline, content: '这里先保留作者说明。\n' + content },
    { path: '07_正文章节/第001章.md', content },
    { path: '作者备忘.md', content }
  ];
  for (const item of unchanged) assert.equal(normalizeCandidate({ ...item, baseHash: null }).change.content, item.content);
});

test('分段合成后仅补一次标题，草稿哈希与已保存正文保持原样', () => {
  const content = fs.readFileSync(new URL('./fixtures/death-right-roadmap-041.md', import.meta.url), 'utf8');
  const at = content.indexOf('| 011 '), next = content.indexOf('| 021 ');
  const first = content.slice(0, at), middle = content.slice(at, next), last = content.slice(next);
  assert.ok(at > 0 && next > at);
  const run = { mode: 'stage', stage: 'S06' } as Run;
  const saved = prepareDocumentDrafts(run, [{ path: paths.outline, baseHash: 'base', content: first, append: true, draftHash: null, final: false }]);
  assert.equal(saved.completed.length, 0); assert.equal(saved.drafts[0].hash, hash(first));
  const second = prepareDocumentDrafts({ ...run, documentDrafts: saved.drafts }, [{ path: paths.outline, baseHash: 'base', content: middle, append: true, draftHash: hash(first), final: false }]);
  const complete = prepareDocumentDrafts({ ...run, documentDrafts: second.drafts }, [{ path: paths.outline, baseHash: 'base', content: last, append: true, draftHash: hash(first + middle), final: true }]);
  assert.equal(complete.completed[0].content, content);
  assert.equal(normalizeCandidate(complete.completed[0]).change.content, '# 章节总纲\n\n' + content);
  assert.equal(saved.drafts[0].content, first);
});
