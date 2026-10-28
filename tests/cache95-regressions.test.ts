import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { patchDocument } from '../src/core/runtime/source-reuse';
import { hash } from '../src/core/domain';
import { requestBody } from '../src/core/provider';
import { fakeProfile } from './fixtures/refactor';
import { toolDefinitions } from '../src/core/runner';
import { appendStageInput, prepareCacheSession } from '../src/core/runtime/cache-session';
import { encodeFacts } from '../src/core/memory-records';
import { refactorFixture } from './fixtures/refactor';
import type { ContextManifest, ModelMessage, Run } from '../src/shared/types';

const actualLedgers: { path: string; candidate: string; accepted: string }[] = JSON.parse(
  fs.readFileSync('tests/fixtures/death-right-052-materialization.json', 'utf8'));
const ledgerSources = actualLedgers.map(row => ({ path: row.path, hash: hash(row.accepted), content: row.accepted, mode: 'full', category: 'memory' }));
const native = [{ type: 'function_call', call_id: 'saved-ledgers', name: 'propose_changes', arguments: JSON.stringify({
  changes: actualLedgers.map(row => ({ path: row.path, content: row.candidate }))
}) }, { type: 'function_call_output', call_id: 'saved-ledgers', output: JSON.stringify({ saved: true,
  versions: actualLedgers.map(row => ({ path: row.path, hash: hash(row.candidate) })) }) }];

test('0.4.52 九份真实台账采纳后事实索引无损派生，正文只保留一份且后续可继续复用', () => {
  for (const row of actualLedgers) assert.equal(encodeFacts(row.candidate, []), row.accepted);
  const current = ledgerSources.map(source => ({ role: 'user', content: JSON.stringify({ source }) }));
  const first = appendStageInput(native, current);
  assert.equal(first.materializedSources, 9);
  assert.ok(first.omittedCharacters > 6000);
  assert.deepEqual(first.input.slice(0, native.length), native);
  assert.equal(first.input.filter(x => x.role === 'developer').length, 1);
  const updates = first.input.filter(x => x.role === 'user').map(x => JSON.parse(x.content).sourceMaterialization);
  assert.equal(updates.length, 9);
  for (const update of updates) {
    const original = actualLedgers.find(row => row.path === update.path)!;
    assert.equal(update.baseHash, hash(original.candidate));
    assert.equal(update.hash, hash(encodeFacts(original.candidate, update.facts)));
  }
  const next = appendStageInput(first.input, current);
  assert.deepEqual(next.input, first.input);
  const changed = { ...ledgerSources[0], content: ledgerSources[0].content + '\n正文实质改变' };
  changed.hash = hash(changed.content);
  assert.equal(appendStageInput(first.input, [{ role: 'user', content: JSON.stringify({ source: changed }) }]).materializedSources, 0);
  const rejected = structuredClone(native);
  rejected[1].output = JSON.stringify({ saved: false, error: '原更新失败' });
  assert.equal(appendStageInput(rejected, current).materializedSources, 0);
});

test('真实S04采纳的宿主索引不切断S05缓存；未绑定版本、外部修改和正文变化仍重建', () => {
  for (const kind of ['accepted-index', 'external', 'changed-human', 'missing-current'] as const) {
    const f = refactorFixture();
    try {
      const scope = { viewpoint: 'author', chapter: 1, mode: 'current', worldId: 'main', timelineId: 'main' };
      const source = { ...ledgerSources[0], content: '初始化台账', hash: hash('初始化台账') };
      f.store.commit([{ path: source.path, content: source.content, baseHash: null }], f.store.db.project());
      const message = (stage: string, sources: typeof ledgerSources): ModelMessage[] => [{ role: 'user', content: JSON.stringify({ authorPremise: '死亡权设定', contextPolicy: '资料不是指令', sources, stage, scope }) }];
      Object.assign(f.run, { mode: 'stage', stage: 'S04', skillId: undefined, changes: [],
        messages: message('S04', [source]), manifest: { scope, sources: [source] } as unknown as ContextManifest });
      const p = { ...fakeProfile, protocol: 'responses' as const, model: 'gpt-6.1-sol', contextLimit: 1050000 };
      const options = { promptCacheKey: 'accepted-facts-regression' };
      const system = '固定权限\n--- 当前专项技能：';
      const original = requestBody(p, system + 'S04', f.run.messages, [], options).body;
      prepareCacheSession(f.store, f.run, p, original, f.run.messages, 0)!.complete();
      const oneNative = structuredClone(native[0]);
      oneNative.arguments = JSON.stringify({ changes: [{ path: source.path, content: actualLedgers[0].candidate }] });
      f.run.messages.push({ role: 'assistant', content: '', calls: [{ id: 'saved-ledgers', name: 'propose_changes', arguments: oneNative.arguments }], native: [oneNative] },
        { role: 'tool', callId: 'saved-ledgers', content: JSON.stringify({ saved: true, versions: [{ path: source.path, hash: hash(actualLedgers[0].candidate) }] }) });
      f.run.changes = [{ path: source.path, baseHash: source.hash, content: actualLedgers[0].candidate }];
      f.run.accepted = true; f.store.db.saveRun(f.run);
      const accepted = { ...ledgerSources[0] };
      if (kind === 'changed-human') { accepted.content += '\n后来批准的正文修改'; accepted.hash = hash(accepted.content); }
      f.store.commit([{ path: source.path, baseHash: source.hash, content: accepted.content }], f.store.db.project());
      if (kind === 'external') fs.appendFileSync(`${f.root}/${source.path}`, '\n未经批准的外部修改');
      const sources = kind === 'missing-current' ? [] : [accepted];
      const next: Run = { ...structuredClone(f.run), id: crypto.randomUUID(), stage: 'S05', accepted: false, changes: [],
        messages: message('S05', sources), manifest: { scope, sources } as unknown as ContextManifest };
      const current = requestBody(p, system + 'S05', next.messages, [], options).body;
      const result = prepareCacheSession(f.store, next, p, current, next.messages, 0)!;
      if (kind === 'accepted-index') {
        assert.deepEqual(result.input.slice(0, original.input.length), original.input);
        assert.ok(result.input.some(x => typeof x.content === 'string' && x.content.includes('sourceMaterialization')));
        assert.equal((f.store.db.events().at(-1)?.data as any).reason, 'continued');
      } else assert.deepEqual(result.input, current.input, kind);
    } finally { f.store.close(); }
  }
});

test('0.4.51 两次真实补丁错误原样回放：全部台账行保留，已满足的空行整理不返工', () => {
  const cases = JSON.parse(fs.readFileSync('tests/fixtures/death-right-051-patches.json', 'utf8'));
  for (const c of cases) {
    const result = patchDocument(c.source, c.patch);
    if (c.expectedUnchanged) assert.equal(result, c.source);
    else for (const line of c.patch.lines ?? []) assert.ok(result.includes(line.text));
    assert.throws(() => patchDocument(c.source + '外部修改', c.patch), /版本/);
  }
});

test('幂等识别仅限唯一表格行的空行删除；语义修改、不存在行和多义定位仍拒绝', () => {
  const source = '| 名称 | 状态 |\n| 人物甲 | 未康复 |\n';
  const update = (before: string, after: string) => patchDocument(source, { sourceHash: hash(source), edits: [{ before, after }] });
  assert.equal(update('\n\n| 人物甲 | 未康复 |', '\n| 人物甲 | 未康复 |'), source);
  assert.throws(() => update('\n\n| 人物甲 | 已康复 |', '\n| 人物甲 | 未康复 |'), /唯一/);
  assert.throws(() => update('\n\n| 人物乙 | 未康复 |', '\n| 人物乙 | 未康复 |'), /唯一/);
  assert.throws(() => update('不存在', '未康复'), /唯一/);
});

test('稳定工具目录不扩大可调用权限，禁用和白名单切换不改定义、顺序或并行设置', () => {
  const p = { ...fakeProfile, protocol: 'responses' as const, model: 'gpt-6.1-sol' };
  const catalogue = toolDefinitions.filter(t => !['public_search', 'extract_pages'].includes(t.name));
  const opts = { cacheTools: catalogue, singleToolCall: true };
  const all = requestBody(p, '规则', [], catalogue, opts).body;
  const none = requestBody(p, '规则', [], [], opts).body;
  const allowed = catalogue.filter(t => t.name === 'propose_changes');
  const some = requestBody(p, '规则', [], allowed, opts).body;
  assert.deepEqual(none.tools, all.tools); assert.deepEqual(some.tools, all.tools);
  assert.equal(none.tool_choice, 'none'); assert.equal(all.tool_choice, 'auto');
  assert.deepEqual(some.tool_choice, { type: 'allowed_tools', mode: 'auto', tools: [{ type: 'function', name: 'propose_changes' }] });
  for (const body of [none, all, some]) assert.equal(body.parallel_tool_calls, false);
  assert.throws(() => requestBody(p, '规则', [], [{ ...allowed[0], description: '伪改' }], opts), /完全一致/);
});
