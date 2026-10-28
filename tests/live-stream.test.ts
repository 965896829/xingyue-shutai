import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveStream } from '../src/shared/live-stream';
import { narrativePlan, narrativeProgress } from '../src/shared/narrative-playback';
import { markdownBlocks } from '../src/ui/markdown-blocks';
import { marked } from 'marked';
import { playbackPlan, playbackProse } from './fixtures/streaming-playback';

test('burst updates share a bounded frame clock and identical text for every subscriber', () => {
  let scheduled = 0;
  const stream = new LiveStream(() => scheduled++), a: string[] = [], b: string[] = [];
  stream.subscribe(() => a.push(stream.snapshot())); stream.subscribe(() => b.push(stream.snapshot()));
  stream.seed({ text: '', running: true, version: 0, epoch: 'draft' }, 0);
  for (let i = 0; i < 10; i++) stream.push({ text: '新的正文', offset: i * 4, version: i + 1, epoch: 'draft', seq: i + 1 }, i);
  assert.equal(stream.snapshot(), ''); assert.ok(scheduled > 0);
  assert.equal(stream.frame(16), true); assert.ok(stream.text.length > 0 && stream.text.length < 40);
  stream.frame(100); assert.equal(stream.text, '新的正文'.repeat(10)); assert.deepEqual(a, b);
});

test('late persistence and duplicated deltas never roll prose back or append twice', () => {
  const stream = new LiveStream(() => {});
  stream.seed({ text: '开头', running: true, version: 2, epoch: 'draft' }, 0);
  stream.push({ text: '下一段', offset: 2, version: 3, epoch: 'draft', seq: 10 }, 0);
  stream.push({ text: '下一段', offset: 2, version: 3, epoch: 'draft', seq: 10 }, 1);
  stream.frame(100);
  stream.seed({ text: '开头', running: true, version: 2, epoch: 'draft' }, 101);
  assert.equal(stream.text, '开头下一段');
});

test('repair attempt resets the previous draft and terminal text is authoritative', () => {
  const stream = new LiveStream(() => {});
  stream.seed({ text: '旧正文很长很长', running: true, version: 4, epoch: 'draft' }, 0);
  stream.push({ text: '新', offset: 0, version: 5, epoch: 'draft', seq: 7 }, 1); stream.frame(101);
  assert.equal(stream.text, '新');
  stream.seed({ text: '旧正文很长很长', running: false, version: 4, epoch: 'draft' }, 102);
  assert.equal(stream.text, '新');
  stream.seed({ text: '新正文（最终整理）', running: false, version: 6, epoch: 'draft' }, 103);
  assert.equal(stream.text, '新正文（最终整理）');
});

test('new execution and worker fencing discard late old events', () => {
  const stream = new LiveStream(() => {});
  stream.push({ text: '旧', offset: 0, version: 10, epoch: 'old', seq: 30, generation: 1, streamEpoch: 'a' }, 0);
  stream.push({ text: '新', offset: 0, version: 1, epoch: 'new', seq: 1, generation: 2, streamEpoch: 'b' }, 1);
  stream.push({ text: '错误', offset: 0, version: 11, epoch: 'old', seq: 31, generation: 1, streamEpoch: 'a' }, 2);
  stream.seed({ text: '旧', running: false, version: 10, epoch: 'old' }, 3);
  stream.frame(101); assert.equal(stream.text, '新');
});

test('a missed prefix is recovered from a snapshot without joining unrelated fragments', () => {
  const stream = new LiveStream(() => {});
  stream.seed({ text: '甲', running: true }, 0);
  stream.push({ text: '丁', offset: 3, seq: 1 }, 1); stream.frame(101); assert.equal(stream.text, '甲');
  stream.seed({ text: '甲乙丙', running: true }, 102); stream.frame(202); assert.equal(stream.text, '甲乙丙丁');
});

test('a newer saved recovery epoch replaces an old view even without new model tokens', () => {
  const stream = new LiveStream(() => {});
  stream.push({ text: '旧正文', offset: 0, version: 8, epoch: 'old', seq: 3 }, 0); stream.frame(100);
  stream.seed({ text: '已恢复正文', running: false, version: 9, epoch: 'recovered' }, 101);
  assert.equal(stream.text, '已恢复正文');
});

test('late events cannot reopen a retired transport even when worker generation is unavailable', () => {
  const stream = new LiveStream(() => {});
  stream.push({ text: '开始', offset: 0, seq: 30, streamEpoch: 'a' }, 0);
  stream.push({ text: '继续', offset: 2, seq: 1, streamEpoch: 'b' }, 1);
  stream.push({ text: '错误', offset: 4, seq: 31, streamEpoch: 'a' }, 2);
  stream.frame(102); assert.equal(stream.text, '开始继续');
});

test('Unicode transport splits never display a lone high surrogate and finish losslessly', () => {
  const stream = new LiveStream(() => {}), expected = '中文𠮷👩‍🔧结束';
  for (let i = 0; i < expected.length; i++) {
    stream.push({ text: expected[i], offset: i, seq: i + 1 }, i * 120);
    stream.frame(i * 120 + 110);
    assert.ok(!/[\uD800-\uDBFF]$/.test(stream.text));
  }
  assert.equal(stream.text, expected);
});

test('long streams survive delta buffer rollover without a disk checkpoint', () => {
  const stream = new LiveStream(() => {}), expected = '正文'.repeat(40000);
  for (let i = 0; i < expected.length; i += 250) stream.push({ text: expected.slice(i, i + 250), offset: i, seq: i + 1 }, i);
  stream.frame(100000); assert.equal(stream.text, expected);
});

test('stop, hidden page and reduced motion can flush without an animation tail', () => {
  const stream = new LiveStream(() => {});
  stream.push({ text: '已经收到的正文', offset: 0, seq: 1 }, 0);
  assert.equal(stream.frame(1, true), false); assert.equal(stream.text, '已经收到的正文');
  stream.seed({ text: '已保存', running: false }, 2); assert.equal(stream.text, '已保存');
});

test('existing saved chapter plans supply scene order and strength without invented ratings', () => {
  const plan = narrativePlan(playbackPlan);
  assert.equal(plan.strength, 4); assert.equal(plan.scenes.length, 4);
  assert.equal(plan.scenes[0].title, '场面1：发现故障');
  assert.match(plan.scenes[1].action, /旧阀门/); assert.equal('pressure' in plan, false);
  assert.equal(narrativePlan('仅有正文').scenes.length, 0);
});

test('narrative progress uses displayed prose, excludes headings and holds below completion while writing', () => {
  const initial = narrativeProgress('# 第001章\n\n', 2500, 4, false); assert.equal(initial.characters, 0);
  const progress = narrativeProgress('一'.repeat(1300), 2500, 4, false);
  assert.equal(progress.scene, -1); assert.equal(progress.ratio, 0.52);
  assert.equal(narrativeProgress(playbackProse, 2500, 4, false).ratio, 0.98);
  assert.equal(narrativeProgress(playbackProse, 2500, 4, true).ratio, 1);
});

const markdownCases = [
  '# 标题\n\n首段**加粗**。\n\n第二段',
  '段落\n\n```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n末尾',
  '| 章节 | 正文 |\n|---|---|\n|001|文本|\n\n结尾',
  '- 第一项\n  - 子项\n\n- 第二项\n\n> 引用\n> 内容',
  '[参考][ref]\n\n其他段落\n\n[ref]: https://example.com',
  '<div>\n\n**正文**\n\n</div>',
  'a\n\n---\n\n<script>alert(1)</script>'
];
for (const [index, markdown] of markdownCases.entries()) test(`incremental Markdown keeps parser output ${index + 1}`, () => {
  assert.equal(markdownBlocks(markdown).map(block => block.html).join(''), marked.parse(markdown, { async: false }));
});
test('completed paragraph objects remain stable when only the tail grows', () => {
  const first = markdownBlocks('第一段。\n\n第二段');
  const second = markdownBlocks('第一段。\n\n第二段继续输出', first);
  assert.equal(first[0], second[0]); assert.notEqual(first[1], second[1]);
});
