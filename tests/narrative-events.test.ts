import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { NarrativeDecoder, decodeNarrativeResponse, visibleNarrativeEvents } from '../src/shared/narrative-events';
import { LiveNarrative } from '../src/shared/live-narrative';
import { saveNarrativeEvents, readNarrativeData, ownsNarrativeSource } from '../src/core/narrative-curves';
import { prepareAuthorRevision } from '../src/core/runtime/run-recovery';
import { Service } from '../src/core/service';
import { FileStore } from '../src/core/storage';
import { prosePath, qualityPath, stageOutputs, hash } from '../src/core/domain';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';
import { fixture, sampleProse } from './fixtures/workflow';
import { RequestError } from '../src/core/provider';
import type { AppEvent, StageId } from '../src/shared/types';

const first = '林川翻过手里的旧账本，看见那行被人涂改的名字。';
const second = '门外的👩‍🔧停下脚步，说水已经送到每家门口。';
const node = (anchor = first, kind = 'reversal', overrides = {}) => ({ kind, label: '账本被改', intensity: 4, anchor, emotion: '信任→疑虑', valence: -1, ...overrides });
const annotation = (value: unknown) => `<!--wenxu-event:${JSON.stringify(value)}-->`;
const clean = `# 第一章\r\n\r\n${first}\r\n\r\n${second}\r\n`;
const raw = clean.replace(first, first + annotation(node())).replace(second, second + annotation(node(second, 'payoff', { intensity: 2, valence: 2 })));

test('同一正文响应的事件元数据在所有切分边界分离，正文逐字保留', () => {
  for (let boundary = 0; boundary <= raw.length; boundary++) {
    let output = ''; const arrived: number[] = [];
    const decoder = new NarrativeDecoder(text => { output += text; }, event => {
      assert.equal(output.slice(event.start, event.end), event.anchor);
      arrived.push(event.end);
    });
    decoder.push(raw.slice(0, boundary)); decoder.push(raw.slice(boundary)); decoder.finish(); decoder.finish();
    assert.equal(output, clean); assert.equal(decoder.text, clean); assert.equal(decoder.events.length, 2);
    assert.equal(arrived.length, 2); assert.equal(decoder.ignored, 0);
  }
  const decoder = new NarrativeDecoder();
  for (const byte of raw.split('')) decoder.push(byte);
  decoder.finish(); assert.equal(decoder.text, clean); assert.equal(decoder.events.length, 2);
});

test('普通注释、Markdown、Unicode 和未完成的普通标点不被传输解析器改写', () => {
  for (const prose of ['<!--普通批注-->\n**原文**𠮷。', '末尾<', '末尾<!--', '正文<!--wen', 'x<!--wenxu-events:不是保留标记-->']) {
    const decoder = new NarrativeDecoder(); for (const c of prose) decoder.push(c); decoder.finish();
    assert.equal(decoder.text, prose); assert.equal(decoder.events.length, 0);
  }
});

test('模型把附带 JSON 换行排版也不会泄漏到正文，逐字符传输与整段结果相同', () => {
  const formatted = first + '<!--wenxu-event:\n' + JSON.stringify(node(), null, 2) + '\n-->' + '\n\n' + second;
  const decoder = new NarrativeDecoder();
  for (const character of formatted) decoder.push(character);
  decoder.finish();
  assert.equal(decoder.text, first + '\n\n' + second);
  assert.equal(decoder.events.length, 1);
  assert.equal(decodeNarrativeResponse(formatted).text, decoder.text);
});

test('坏 JSON、越界评分、未来/重复/乱序锚点只忽略节点，不修改正文或要求重试', () => {
  const invalid = first + '<!--wenxu-event:{bad}-->' + annotation(node(first, 'climax', { intensity: 6 })) + annotation(node(second)) +
    annotation(node()) + annotation(node()) + '\n\n' + second + annotation(node(second, 'payoff')) + annotation(node());
  const result = decodeNarrativeResponse(invalid);
  assert.equal(result.text, first + '\n\n' + second); assert.equal(result.events.length, 2); assert.equal(result.ignored, 5);
  const duplicate = decodeNarrativeResponse(first + first + annotation(node()));
  assert.equal(duplicate.events.length, 0); assert.equal(duplicate.text, first + first);
});

test('截断与超大节点不能吞掉其后段落，最多保留32个有效节点', () => {
  for (const bad of ['<!--wenxu-event:{"kind":', '<!--wenxu-event:' + 'x'.repeat(5000)]) {
    const decoder = new NarrativeDecoder();
    for (const chunk of [first, bad.slice(0, 4400), bad.slice(4400), '\n\n', second]) decoder.push(chunk);
    decoder.finish(); assert.equal(decoder.text, first + '\n\n' + second); assert.ok(decoder.ignored > 0);
    assert.equal(decodeNarrativeResponse(first + bad).text, first);
  }
  const lines = Array.from({ length: 40 }, (_, i) => `第${i}处水阀已经完全关闭。`);
  const result = decodeNarrativeResponse(lines.map(line => line + annotation(node(line))).join('\n'));
  assert.equal(result.text, lines.join('\n')); assert.equal(result.events.length, 32); assert.equal(result.ignored, 8);
});

test('节点必须等动画正文完整显示该原句后才出现，不能混入另一稿', () => {
  const events = decodeNarrativeResponse(raw).events;
  for (let i = 0; i < clean.length; i++) {
    const visible = visibleNarrativeEvents(events, clean.slice(0, i));
    assert.ok(visible.every(point => point.end <= i && clean.slice(point.start, point.end) === point.anchor));
  }
  assert.equal(visibleNarrativeEvents(events, clean).length, 2);
  assert.equal(visibleNarrativeEvents(events, '另一稿'.repeat(clean.length)).length, 0);
});

test('事件呈现缓存拒绝旧版本、乱序事件和退役连接；等版本快照不擦除新节点', () => {
  let scheduled = 0; const stream = new LiveNarrative(() => scheduled++), events = decodeNarrativeResponse(raw).events;
  stream.seed({ version: 1, epoch: 'a', events: [] }, 'a', 1);
  stream.push({ epoch: 'a', version: 2, events, seq: 2, transport: 'one', generation: 1 });
  stream.seed({ version: 1, epoch: 'a', events: [] }, 'a', 2);
  assert.equal(stream.snapshot().length, 2);
  const previous = stream.snapshot(); stream.push({ epoch: 'a', version: 2, events: [...events], seq: 3, transport: 'one', generation: 1 });
  assert.equal(stream.snapshot(), previous); assert.equal(scheduled, 1);
  stream.seed(undefined, 'b', 3); assert.equal(stream.snapshot().length, 0);
  for (const stale of [{ epoch: 'a', version: 6 }, { epoch: 'unknown-old', version: 2 }, { epoch: 'unknown-equal', version: 3 }])
    stream.push({ ...stale, events, seq: 8, transport: 'one', generation: 1 });
  assert.equal(stream.snapshot().length, 0);
  stream.push({ epoch: 'b', version: 4, events, seq: 1, transport: 'two', generation: 2 });
  stream.push({ epoch: 'b', version: 5, events: [], seq: 99, transport: 'one', generation: 1 });
  assert.equal(stream.snapshot().length, 2);
  stream.push({ epoch: 'b', version: 5, events: [], seq: 1, transport: 'two', generation: 2 });
  assert.equal(stream.snapshot().length, 2);
});

test('重写的第一段即清除旧节点，即使两稿开头完全相同；后续文本不清空本稿节点', () => {
  const events = decodeNarrativeResponse(raw).events, stream = new LiveNarrative(() => {});
  stream.seed({ version: 1, epoch: 'old', events }, 'old', 3);
  stream.beginDraft('new', 4); assert.equal(stream.snapshot().length, 0);
  stream.push({ epoch: 'new', version: 5, events: events.slice(0, 1), seq: 1 });
  stream.beginDraft('new', 6); assert.equal(stream.snapshot().length, 1);
  stream.beginDraft('old', 20); assert.equal(stream.snapshot().length, 1);
});

test('节点随正文哈希持久化；重开可定位；重写清除旧绑定；旧项目仍可读取', () => {
  const f = refactorFixture(), events = decodeNarrativeResponse(raw).events;
  let closed = false;
  f.run.pipeline = { phase: 'ready', epoch: 'original', version: 4, previewCalls: 0, proseHash: hash(clean), narrative: { version: 1, epoch: 'original', events } };
  f.run.changes = [{ path: prosePath(1), content: clean, baseHash: null }];
  try {
    assert.equal(readNarrativeData(f.store, 1).eventRecord, undefined);
    saveNarrativeEvents(f.store, f.run, clean); f.store.db.saveRun(f.run);
    const record = readNarrativeData(f.store, 1, f.run.id).eventRecord!;
    assert.equal(record.events.length, 2); assert.equal(record.source.hash, hash(clean));
    assert.ok(ownsNarrativeSource(f.store, { ...record.source, quote: first }));
    assert.ok(!ownsNarrativeSource(f.store, { ...record.source, quote: '伪造原句' }));
    prepareAuthorRevision(f.run, '重写当前章');
    assert.equal(f.run.pipeline?.narrative, undefined); assert.equal(f.run.pipeline?.proseHash, undefined);
    f.store.db.saveRun(f.run); assert.equal(readNarrativeData(f.store, 1, f.run.id).eventRecord, undefined);
    f.store.commit([{ path: prosePath(1), content: clean, baseHash: null }], f.project);
    f.store.close(); closed = true; const reopened = new FileStore(f.root);
    try { assert.equal(readNarrativeData(reopened, 1).eventRecord?.events.length, 2); }
    finally { reopened.close(); }
  } finally { if (!closed) f.store.close(); }
});

const stages: StageId[] = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09'];
async function runChapter(metadata: boolean, interrupted = false) {
  const emitted: AppEvent[] = [], phases: string[] = [];
  const prose = sampleProse(200), sentence = prose.split('\n\n')[1].slice(0, 24);
  const stream = metadata ? prose.replace(sentence, sentence + annotation(node(sentence))) : prose;
  const service: Service = new Service(path.resolve('resources/skill'), event => emitted.push(event), async (_profile, system, messages, tools, _signal, delta) => {
    const run = service.store!.db.runs().find(r => r.status === 'running')!;
    phases.push(run.pipeline!.phase);
    assert.ok(!JSON.stringify(messages).includes('<!--wenxu-event'), '下游请求只能收到纯正文');
    if (!tools.length) {
      assert.match(system, /正文同步节点/);
      for (let i = 0; i < stream.length; i += 11) delta?.(stream.slice(i, i + 11));
      if (metadata) assert.ok(emitted.some(e => e.type === 'narrative-event'), '本次响应结束前已经发出节点');
      if (interrupted) throw new RequestError('离线夹具模拟中转断流', true, { source: 'upstream', code: 'upstream_stream_read_error' });
      return fakeResult(stream);
    }
    const project = service.store!.db.project();
    const outputs = run.pipeline!.phase === 'review' ? [qualityPath(1)] : stageOutputs('S11', project);
    return { ...fakeResult(''), stop: 'tools', calls: [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes: outputs.map(file => service.change(file, fixture(project, file, service))) }) },
      ...(run.pipeline!.phase === 'memory' ? [{ id: crypto.randomUUID(), name: 'propose_memory', arguments: JSON.stringify({ facts: [], complete: true }) }] : [])] };
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 1000000, outputLimit: 4096 }];
  await service.invoke('project.create', { parent: isolatedRoot('narrative-events'), title: '叙事事件隔离验收', premise: '伤员求医',
    config: { defaultProfileId: fakeProfile.id, targetWords: 6000, chapterWords: 200, minWords: 200, maxWords: 200, maxRounds: 12, maxTools: 64,
      preview: { enabled: false }, expressionRules: { enabled: false } } });
  const p = service.store!.db.project();
  for (const prior of stages) service.store!.commit(stageOutputs(prior, p).map(file => service.change(file, fixture(p, file, service))), p);
  p.stage = 'S10'; service.store!.db.set('project', p);
  const run = service.makeRun('stage', '完成当前章，保留原有必要字段'); service.store!.db.saveRun(run);
  try {
    await service.runner!.drive(run.id);
    const done = service.store!.db.run(run.id);
    assert.equal(done.changes.find(c => c.path === prosePath(1))?.content, prose);
    assert.ok(!JSON.stringify(done.changes).includes('<!--wenxu-event'));
    return { done, phases, emitted, record: readNarrativeData(service.store!, 1, run.id).eventRecord };
  } finally { await service.drain(); }
}

test('S10 正文同一请求实时发节点，完整流程请求数、Skill 文件结构与无节点版本一致', async () => {
  const original = await runChapter(false), current = await runChapter(true);
  for (const result of [original, current]) {
    assert.equal(result.done.status, 'awaiting_review', JSON.stringify({ error: result.done.error, issues: result.done.issues, phases: result.phases }));
    assert.equal(result.done.pipeline?.phase, 'ready');
    assert.deepEqual(result.phases, ['prose', 'review', 'memory']);
    assert.ok(!result.done.repairAttempts?.prose);
  }
  assert.deepEqual(current.done.changes.map(c => c.path).sort(), original.done.changes.map(c => c.path).sort());
  assert.equal(current.record?.events.length, 1); assert.equal(original.record?.events.length, 0);
  assert.equal(current.emitted.filter(e => e.type === 'prose-delta').map(e => e.text).join(''), sampleProse(200));
});

test('正文断流保留干净草稿和已写节点，不自动重发、不补可视化请求', async () => {
  const result = await runChapter(true, true);
  assert.equal(result.done.status, 'unknown', result.done.error ?? '');
  assert.deepEqual(result.phases, ['prose']);
  assert.equal(result.done.pipeline?.narrative?.events.length, 1);
  assert.equal(result.done.pipeline?.proseHash, undefined);
  assert.equal(result.done.usage.cost, null);
});
