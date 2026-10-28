import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewWithRepair } from '../src/core/runtime/review-receipts';
import { refactorFixture } from './fixtures/refactor';
import type { Run } from '../src/shared/types';

test('完整 JSON 围栏仅本地解包，负面结论不变，不为格式增加复查请求', async () => {
  const f = refactorFixture(); let calls = 0;
  try {
    const raw = '```JSON\n{"verdict":"contradicted","quote":"没有交付"}\n```';
    const result = await reviewWithRepair(f.store, 'uppercase-wrapper', 2, async () => { calls++; return raw; }, JSON.parse, () => { throw new Error('不应进入模型修复'); });
    assert.equal(result.verdict, 'contradicted'); assert.equal(calls, 1);
    assert.equal((await reviewWithRepair(f.store, 'uppercase-wrapper', 2, async () => { throw new Error('不应重复联网'); }, JSON.parse, () => {})).quote, '没有交付');
  } finally { f.store.close(); }
});

test('回执修复追加原输出和具体错误；保存有效回执，输入变化后才重新审查', async () => {
  const f = refactorFixture();
  try {
    let calls = 0;
    const raw = '{"verdict":"contradicted","quote":"虚构引文"}';
    const send = async (messages: Run['messages']) => {
      calls++;
      if (calls === 1) { assert.deepEqual(messages, []); return raw; }
      if (calls === 2) {
        assert.equal(messages.length, 2); assert.equal(messages[0].role, 'assistant'); assert.equal(messages[0].content, raw);
        assert.match(messages[1].content, /引文不在原文中/);
        assert.match(messages[1].content, /不把否定或不明确结论改成默认通过/);
      }
      return '{"verdict":"contradicted","quote":"没有交付"}';
    };
    const parse = (text: string) => { const value = JSON.parse(text); if (value.quote !== '没有交付') throw new Error('引文不在原文中'); return value; };
    const audit = (binding: unknown) => reviewWithRepair(f.store, binding, 2, send, parse, () => {});
    assert.equal((await audit({ source: '版本1' })).verdict, 'contradicted');
    assert.equal(calls, 2);
    assert.equal((await audit({ source: '版本1' })).verdict, 'contradicted'); assert.equal(calls, 2);
    await audit({ source: '版本2' }); assert.equal(calls, 3);
  } finally { f.store.close(); }
});

test('中断恢复保留上次错误和回执；失败修复预算不因恢复而重置', async () => {
  const f = refactorFixture();
  try {
    let calls = 0;
    const send = async (messages: Run['messages']) => {
      calls++;
      if (calls === 2) throw new Error('网络中断');
      if (calls > 2) assert.equal(messages[0].content, '无效回执1');
      return `无效回执${calls}`;
    };
    const audit = () => reviewWithRepair(f.store, '同一输入', 2, send,
      () => { throw new Error('未逐条覆盖'); }, () => {});
    await assert.rejects(audit(), /网络中断/); assert.equal(calls, 2);
    await assert.rejects(audit(), /未逐条覆盖/); assert.equal(calls, 4);
    await assert.rejects(audit(), /未逐条覆盖/); assert.equal(calls, 4);
  } finally { f.store.close(); }
});
