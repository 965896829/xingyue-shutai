import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { hash } from '../src/core/domain';
import { materializeChanges, patchDocument } from '../src/core/runtime/source-reuse';
import { refactorFixture } from './fixtures/refactor';

const captured = JSON.parse(fs.readFileSync('tests/fixtures/death-right-054-line-patches.json', 'utf8')) as {
  request: number; path: string; source: string; patch: Parameters<typeof patchDocument>[1];
  expected: string; sourceHash: string; expectedHash: string;
}[];

test('0.4.54 两次真实行补丁原样通过，五列表和六列表各写入正确位置', () => {
  assert.deepEqual(captured.map(row => row.request), [16, 17]);
  for (const row of captured) {
    assert.equal(hash(row.source), row.sourceHash);
    assert.equal(hash(row.expected), row.expectedHash);
    const actual = patchDocument(row.source, row.patch);
    assert.equal(actual, row.expected);
    const [items, injuries] = actual.split('## 伤势');
    assert.match(items, /00000号黑色死亡权证/);
    assert.doesNotMatch(items, /致命，死亡/);
    assert.match(injuries, /致命，死亡/);
    assert.doesNotMatch(injuries, /00000号黑色死亡权证/);
    assert.throws(() => patchDocument(row.source + '\n外部修改', row.patch), /版本/);
  }
});

test('完整行优先且不规范化字节，CRLF、Unicode、首末行和无末尾换行均保留', () => {
  for (const newline of ['\n', '\r\n']) {
    const source = ['𠮷 | 手机', '𠮷 | 手机 | 未丢失', '末行𠮷'].join(newline);
    assert.equal(patchDocument(source, { sourceHash: hash(source), lines: [
      { anchor: '𠮷 | 手机', text: '𠮷 | 手机（随身）' },
      { anchor: '末行𠮷', text: '结束𠮷' },
    ] }), ['𠮷 | 手机（随身）', '𠮷 | 手机 | 未丢失', '结束𠮷'].join(newline));
  }
  const source = '甲\n 甲 \n';
  assert.equal(patchDocument(source, { sourceHash: hash(source), lines: [{ anchor: '甲', text: '乙' }] }), '乙\n 甲 \n');
});

test('完整行重复或不存在时不猜选，重复子串仍拒绝并报告准确锚点和次数', () => {
  for (const [source, exact, substring] of [
    ['甲\n甲\n甲乙', 2, 3], ['甲乙\n丙甲', 0, 2], ['甲甲', 0, 2], ['丙丁', 0, 0],
  ] as const) {
    assert.throws(() => patchDocument(source, { sourceHash: hash(source), lines: [{ anchor: '甲', text: '乙' }] }),
      (error: Error) => error.message.includes('lines[0] anchor="甲"') &&
        error.message.includes(`完整行匹配=${exact}，子串匹配=${substring}`));
  }
  assert.equal(patchDocument('未受伤𠮷，无治疗\n', { sourceHash: hash('未受伤𠮷，无治疗\n'), lines: [
    { anchor: '𠮷', text: '伤势原样，未发生治疗' },
  ] }), '伤势原样，未发生治疗\n');
});

test('整行定位不放松重叠、空锚点、换行锚点及错版本保护', () => {
  const source = '甲\n甲乙\n';
  const patch = { sourceHash: hash(source), lines: [{ anchor: '甲', text: '丙' }] };
  assert.throws(() => patchDocument(source, { ...patch, edits: [{ before: '甲\n', after: '丁\n' }] }), /重叠/);
  assert.throws(() => patchDocument(source, { ...patch, lines: [...patch.lines, ...patch.lines] }), /重叠/);
  for (const anchor of ['', '甲\n', '甲\r']) {
    assert.throws(() => patchDocument(source, { ...patch, lines: [{ anchor, text: '丙' }] }), /不能为空或包含换行/);
  }
  assert.throws(() => patchDocument(source, { ...patch, sourceHash: hash('别的版本') }), /版本/);
});

test('批量增量拒绝定位到文件和锚点，不返回或保存前面已计算的候选', () => {
  const f = refactorFixture();
  try {
    const path = '04_连续性记忆库/物品与伤势.md', source = '甲\n甲\n';
    f.store.commit([{ path, baseHash: null, content: source }], f.store.db.project());
    const prior = f.store.readAccepted('正文.md'), run = { ...f.run, changes: [] };
    const stateBefore = JSON.stringify(run);
    assert.throws(() => materializeChanges(f.store, run, f.store.db.project(), [
      { path: '正文.md', baseHash: prior.hash, patch: { sourceHash: prior.hash, lines: [{ anchor: '原稿𠮷', text: '不得提前保存' }] } },
      { path, baseHash: hash(source), patch: { sourceHash: hash(source), lines: [{ anchor: '甲', text: '乙' }] } },
    ]), (error: Error) => error.message.includes(`[${path}]`) && error.message.includes('lines[0] anchor="甲"') &&
      error.message.includes('完整行匹配=2'));
    assert.equal(JSON.stringify(run), stateBefore);
    assert.equal(f.store.readAccepted('正文.md').content, prior.content);
    assert.equal(f.store.readAccepted(path).content, source);
    assert.throws(() => materializeChanges(f.store, run, f.store.db.project(), [
      { path, baseHash: hash(source), patch: { sourceHash: hash(source), edits: [{ before: '无此项', after: '不写入' }] } },
    ]), (error: Error) => error.message.includes(`[${path}]`) && error.message.includes('edits[0] before="无此项"'));
  } finally { f.store.close(); }
});

test('真实物品补丁经文件物化仍保持版本、原文件及整份目标结构', () => {
  const f = refactorFixture();
  try {
    const row = captured[0];
    f.store.commit([{ path: row.path, baseHash: null, content: row.source }], f.store.db.project());
    const changes = materializeChanges(f.store, { ...f.run, changes: [] }, f.store.db.project(), [
      { path: row.path, baseHash: row.sourceHash, patch: row.patch },
    ]);
    assert.deepEqual(changes, [{ path: row.path, baseHash: row.sourceHash, content: row.expected }]);
    assert.equal(f.store.readAccepted(row.path).content, row.source);
  } finally { f.store.close(); }
});
