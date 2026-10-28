import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { fanqieBookUrl, parseFanqieCatalogue, readFanqieCatalogue } from '../src/core/fanqie-catalogue';
import { prepareVolumeMarketResearch, volumeNamingContext, upgradesVolumeNaming } from '../src/core/volume-market-research';
import { titleSearchTopic } from '../src/core/title-market-research';
import { makeCreationSpec, tagBundle } from '../src/core/tags';
import { emptyTagInput } from '../src/shared/tags';
import { searchSettingsSchema } from '../src/shared/assistant';
import type { CreationPlan } from '../src/shared/creation';
import type { NativeWebSearchState } from '../src/shared/web-search';
import { newProject, hash, paths, stageOutputs } from '../src/core/domain';
import { Service } from '../src/core/service';
import { SkillRegistry } from '../src/core/skill-registry';
import { RequestError } from '../src/core/provider';
import { VolumeMarketEvidence } from '../src/ui/VolumeMarketEvidence';
import { fakeProfile, fakeResult, isolatedRoot, refactorFixture } from './fixtures/refactor';
import { fixture } from './fixtures/workflow';

const root = path.resolve('resources/skill');
const url = 'https://fanqienovel.com/page/111';
// Minimal official markup shape, with synthetic prose, not copied book content.
const catalogueHtml = `<h1>目录测试书</h1><span class="author-name-text">测试作者</span>
<span class="info-label-grey">都市脑洞</span><span class="info-label-grey">求生</span>
<div class="page-abstract-content"><p>合成城市故事。</p></div>
<div class="page-directory-content"><div>
<div class="volume volume_first">第一卷：停在门外<span class="volume-dot"></span>共<!-- -->18<!-- -->章</div>
<div class="chapter"><a class="chapter-item-title">第1章 不能当卷名</a></div>
<div class="volume">第二卷：&#x95E8;里的回声<span class="volume-dot"></span>共<!-- -->20<!-- -->章</div>
<div class="volume">第三卷：默认<span>共50章</span></div><div class="volume">第四卷<span>共5章</span></div>
<div class="volume">番外<span>共5章</span></div></div></div>
<div class="footer"><div class="volume">页脚不算卷名</div></div>
<script>const fake='<div class="volume">脚本不算卷名</div>';</script>`;

test('卷名目录只读取目录分卷，不混入书名、章名、默认卷、脚本或页脚；保留有来源的原名', () => {
  const parsed = parseFanqieCatalogue(catalogueHtml, url, '2026-10-27T00:00:00Z')!;
  assert.equal(parsed.title, '目录测试书');
  assert.equal(parsed.author, '测试作者');
  assert.deepEqual(parsed.categories, ['都市脑洞', '求生']);
  assert.deepEqual(parsed.volumes, ['第一卷：停在门外', '第二卷：门里的回声']);
  assert.equal(parsed.contentHash, hash(catalogueHtml));
  assert.equal(parsed.checkedAt, '2026-10-27T00:00:00Z');
  assert.equal(parseFanqieCatalogue(catalogueHtml.replace('第二卷：&#x95E8;里的回声', '第二卷：正文'), url), null);
  assert.equal(parseFanqieCatalogue('<h1>书</h1><p>第一卷：卷名，第二卷：卷名</p>', url), null);
  assert.equal(parseFanqieCatalogue('x'.repeat(2_500_001), url), null);
});

test('目录读取限定官方HTTPS作品页，不允许伪域名、非默认端口、认证字段和聚合页', async () => {
  assert.equal(fanqieBookUrl('https://www.fanqienovel.com/page/111/?from=search'), url);
  for (const candidate of ['http://fanqienovel.com/page/111', 'https://fanqienovel.com.evil.test/page/111',
    'https://fanqienovel.com:444/page/111', 'https://x:y@fanqienovel.com/page/111',
    'https://fanqienovel.com/keyword/111', 'https://127.0.0.1/page/111']) {
    assert.equal(fanqieBookUrl(candidate), undefined);
    assert.equal(parseFanqieCatalogue(catalogueHtml, candidate), null);
    await assert.rejects(readFanqieCatalogue(candidate, new AbortController().signal, 1000), /非番茄官方/);
  }
});

test('当前都市求生创意优先于未选标签时残留的玄幻配置；书名和卷名共用公开题材路由', () => {
  const p = newProject('不可外送作品名', 'unused', {});
  const spec = makeCreationSpec(p, { ...emptyTagInput(), premise: '都市脑洞大逃杀，私密人物许某' }, 1, tagBundle(root).taxonomy);
  const plan = { statements: [{ kind: 'reader_promise', text: '都市封锁中普通人靠抢修求生，不另设重生或修仙。' }] } as CreationPlan;
  const topic = titleSearchTopic(root, spec, p.config.genre, plan, true);
  assert.equal(topic.genre, '都市脑洞');
  assert.match(topic.query, /都市 大逃杀/);
  assert.doesNotMatch(JSON.stringify(topic), /玄幻|修仙|重生|许某|不可外送|抢修/);
  spec.selection.reading.main = 'reading.main.007';
  assert.equal(titleSearchTopic(root, spec, p.config.genre, plan, true).genre, '悬疑脑洞', '明确选定分类仍优先');
});

function prepared() {
  const f = refactorFixture();
  f.run.stage = 'S05'; f.run.mode = 'stage'; f.run.skillId = 'webnovel-volume-architect';
  f.run.changes = []; f.run.volumeNaming = { version: 1 };
  f.project.stage = 'S05'; f.store.db.set('project', f.project);
  f.store.db.set('premise', '都市脑洞大逃杀');
  const profile = { ...fakeProfile, protocol: 'responses' as const };
  const state: NativeWebSearchState = { calls: [{ id: 'search-once', status: 'completed', sources:
    [1, 2, 3, 4].map(i => ({ title: `搜索标题${i}`, url: `https://fanqienovel.com/page/${i}11` })) }], citations: [] };
  let modelCalls = 0, reads = 0;
  const args: Parameters<typeof prepareVolumeMarketResearch>[0] = {
    ...f, root, profile, settings: searchSettingsSchema.parse({}), signal: new AbortController().signal,
    save: () => f.store.db.saveRun(f.run), event: () => {},
    caller: async (_p, _s, messages, _tools, _signal, _delta, options) => {
      modelCalls++;
      assert.match(messages[0].content, /都市/);
      assert.equal(options?.webSearch?.maxCalls, 2);
      assert.equal(options?.webSearch?.required, true);
      assert.deepEqual(options?.webSearch?.allowedDomains, ['fanqienovel.com']);
      options?.onWebSearch?.(state.calls[0]);
      return { ...fakeResult('优先 https://fanqienovel.com/page/211 再看 https://fanqienovel.com/page/111。无依据链接 https://fanqienovel.com/page/999'), webSearch: state };
    },
    readCatalogue: async source => { reads++; return parseFanqieCatalogue(catalogueHtml, source); }
  };
  return { ...f, args, counts: () => ({ modelCalls, reads }) };
}

test('一批一次研究请求、最多三次目录GET，证据落盘；恢复和修订复用，不重复搜索或摘要', async () => {
  const f = prepared();
  try {
    await prepareVolumeMarketResearch(f.args);
    assert.deepEqual(f.counts(), { modelCalls: 1, reads: 3 });
    assert.equal(f.run.rounds, 1); assert.equal(f.run.toolCount, 4);
    assert.equal(f.run.volumeNaming!.research!.status, 'ready');
    assert.equal(f.run.volumeNaming!.research!.sources[0].url, 'https://fanqienovel.com/page/211');
    assert.ok(f.run.volumeNaming!.research!.reads.every(read => read.finishedAt && read.elapsedMs! >= 0));
    const payload = JSON.stringify(volumeNamingContext(f.run));
    assert.match(payload, /停在门外/); assert.doesNotMatch(payload, /<div|<script|page\/999/);
    f.args.run = f.store.db.run(f.run.id);
    await prepareVolumeMarketResearch(f.args);
    assert.deepEqual(f.counts(), { modelCalls: 1, reads: 3 });
    const html = renderToStaticMarkup(createElement(VolumeMarketEvidence, { research: f.run.volumeNaming!.research }));
    assert.match(html, /<details/); assert.match(html, /已核对 3 本目录/); assert.match(html, /停在门外/);
    assert.doesNotMatch(html, /<button|审核|onclick=/);
  } finally { f.store.close(); }
});

test('只有书名链接或默认目录不能标记实时卷名参考成功；不为补齐样本再次请求', async () => {
  const f = prepared();
  try {
    f.args.readCatalogue = async () => null;
    await prepareVolumeMarketResearch(f.args);
    assert.equal(f.run.volumeNaming!.research!.status, 'unavailable');
    assert.deepEqual(f.run.volumeNaming!.research!.sources, []);
    assert.equal(f.run.rounds, 1);
    await prepareVolumeMarketResearch(f.args);
    assert.equal(f.counts().modelCalls, 1);
  } finally { f.store.close(); }
});

test('未知付费请求保持恢复门槛；从中断记录恢复不重发搜索', async () => {
  const f = prepared(); let attempts = 0;
  try {
    f.args.caller = async () => { attempts++; throw new RequestError('中转结果未知', true); };
    await assert.rejects(prepareVolumeMarketResearch(f.args), /中转结果未知/);
    assert.equal(f.store.db.get(`inflight:${f.run.id}`), true);
    assert.equal(f.run.volumeNaming!.research!.status, 'searching');
    await prepareVolumeMarketResearch(f.args);
    assert.equal(attempts, 1);
    assert.equal(f.run.volumeNaming!.research!.status, 'unavailable');
    assert.equal(f.run.rounds, 1);
  } finally { f.store.close(); }
});

test('目录GET个别失败复用成功项，搜索关闭或额度不足时零额外请求且不阻断生成', async () => {
  for (const mode of ['disabled', 'budget', 'rounds', 'tools', 'partial'] as const) {
    const f = prepared();
    try {
      if (mode === 'disabled') f.args.settings.enabled = false;
      if (mode === 'budget') f.project.config.stageBudget = 1;
      if (mode === 'rounds') f.project.config.maxRounds = 1;
      if (mode === 'tools') f.project.config.maxTools = 2;
      if (mode === 'partial') f.args.readCatalogue = async source => {
        if (source.endsWith('/111')) throw new Error('timeout');
        return parseFanqieCatalogue(catalogueHtml, source);
      };
      await prepareVolumeMarketResearch(f.args);
      if (mode === 'partial') {
        assert.equal(f.run.volumeNaming!.research!.status, 'ready');
        assert.equal(f.run.volumeNaming!.research!.sources.length, 2);
        assert.equal(f.run.volumeNaming!.research!.reads.filter(read => read.status === 'unavailable').length, 1);
      } else {
        assert.equal(f.run.volumeNaming!.research!.status, mode === 'disabled' ? 'disabled' : 'unavailable');
        assert.deepEqual(f.counts(), { modelCalls: 0, reads: 0 });
      }
    } finally { f.store.close(); }
  }
});

test('旧候选只有作者新提卷名修改才启用新规则，保留候选并允许一次目录研究；普通恢复不升级', async () => {
  const f = prepared();
  try {
    delete f.run.volumeNaming;
    for (const request of ['继续', '恢复', '保留卷名，只改章节容量', '卷名不要改', '不要修改卷名'])
      assert.equal(upgradesVolumeNaming(f.run, request), false, request);
    for (const request of ['只改卷名，参考番茄风格', '卷名还是AI味，重新取', '不要这些AI卷名，换一组'])
      assert.equal(upgradesVolumeNaming(f.run, request), true, request);
    f.run.volumeNaming = { version: 1, authorRevision: true };
    f.run.changes = [{ path: paths.volumes, content: '# 已有完整大纲\n原故事不变', baseHash: null }];
    const before = structuredClone(f.run.changes);
    await prepareVolumeMarketResearch(f.args);
    assert.equal(f.counts().modelCalls, 1);
    assert.deepEqual(f.run.changes, before);
    assert.equal(upgradesVolumeNaming(f.run, '再改卷名'), false, '当前批次复用来源，不继续研究');
  } finally { f.store.close(); }
});

test('公共搜索连接只检索一次，之后直接读官方目录，不再调用模型研究或公开提取服务', async () => {
  const f = prepared(); let searches = 0;
  try {
    f.args.profile = fakeProfile;
    f.args.search = { key: 'fixture-public-search', search: async query => {
      searches++; assert.match(query, /都市 大逃杀 小说 分卷 目录/);
      return { query, at: new Date().toISOString(), results: [{ title: '目录测试书', url, content: '搜索摘要不能当目录' }] } as Awaited<ReturnType<NonNullable<typeof f.args.search>['search']>>;
    } };
    await prepareVolumeMarketResearch(f.args);
    assert.equal(searches, 1); assert.equal(f.counts().modelCalls, 0);
    assert.equal(f.run.rounds, 0); assert.equal(f.run.toolCount, 2);
    assert.equal(f.run.volumeNaming!.research!.status, 'ready');
  } finally { f.store.close(); }
});

test('旧S05恢复保持原专项提示；新版与原Codex skill共用卷名规则且不改变模板', () => {
  const legacyRoot = isolatedRoot('legacy-volume-skill');
  fs.cpSync(path.join(root, 'runtime'), path.join(legacyRoot, 'runtime'), { recursive: true });
  const runtime = path.join(legacyRoot, 'runtime');
  const target = 'skills/webnovel-volume-architect/SKILL.md';
  const before = fs.readFileSync(path.join(runtime, 'skills/webnovel-volume-architect/legacy-0.4.71.md'));
  fs.writeFileSync(path.join(runtime, target), before);
  const registry = JSON.parse(fs.readFileSync(path.join(runtime, 'skills.registry.json'), 'utf8'));
  registry.skills.find((s: { id: string }) => s.id === 'webnovel-volume-architect').sha256 = hash(before);
  fs.writeFileSync(path.join(runtime, 'skills.registry.json'), JSON.stringify(registry));
  const lock = JSON.parse(fs.readFileSync(path.join(runtime, 'resources.lock.json'), 'utf8'));
  lock[target] = hash(before); lock['skills.registry.json'] = hash(fs.readFileSync(path.join(runtime, 'skills.registry.json')));
  fs.writeFileSync(path.join(runtime, 'resources.lock.json'), JSON.stringify(lock));
  const historical = new SkillRegistry(legacyRoot).load('webnovel-volume-architect').content;
  const current = new SkillRegistry(root);
  assert.equal(current.load('webnovel-volume-architect', { legacyVolumeNaming: true }).content, historical);
  assert.notEqual(current.load('webnovel-volume-architect').content, historical);
  assert.equal(fs.readFileSync(path.join(root, 'references/volume-naming.md'), 'utf8'), current.read('references/volume-naming.md'));
  assert.equal(hash(before), '853a4bd99f37062f2d84cf9f6785de2f756ccf6b42ed9996dc5047580e2652a8');
});

test('S05集成：一次目录研究后直接生成原结构大纲，来源在任务上下文内，旧任务恢复不加搜索', async () => {
  let service: Service; let calls = 0, directoryReads = 0;
  const systems: string[] = [];
  let submitted = '';
  const profile = { ...fakeProfile, protocol: 'responses' as const, contextLimit: 1000000, outputLimit: 4096 };
  service = new Service(root, () => {}, async (_profile, system, messages, _tools, _signal, _delta, options) => {
    calls++; systems.push(system);
    if (options?.webSearch) return { ...fakeResult(url), webSearch: { calls: [{ id: 'one-search', status: 'completed', sources: [{ title: '目录测试书', url }] }], citations: [] } };
    assert.match(messages[0].content, /volumeNamingReference/); assert.match(messages[0].content, /停在门外/);
    assert.doesNotMatch(system, /目录测试书|停在门外/);
    assert.match(system, /已预载：[^\n]*都市/);
    const p = service.store!.db.project();
    submitted = fixture(p, paths.volumes, service).replace('| 1 | 第一卷 | 1—1200 | 1200 |', '| 第1卷 | 第一卷 | 001—1200 | 1200章 |');
    return { ...fakeResult(''), stop: 'tools', calls: [{ id: 'candidate', name: 'propose_changes', arguments: JSON.stringify({ changes: [service.change(paths.volumes, submitted)] }) }] };
  });
  service.profiles = [profile];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('volume-integration'), title: '合成目录流程', premise: '都市脑洞大逃杀', config: { defaultProfileId: profile.id, maxRounds: 2, preview: { enabled: false } } });
    let p = service.store!.db.project();
    for (const stage of ['S01', 'S02', 'S03', 'S04'] as const) {
      service.store!.commit(stageOutputs(stage, p).map(file => service.change(file, fixture(p, file, service))), p);
      p = service.store!.db.project();
    }
    p.stage = 'S05'; service.store!.db.set('project', p);
    service.runner!.readVolumeCatalogue = async source => { directoryReads++; return parseFanqieCatalogue(catalogueHtml, source); };
    const run = service.makeRun('stage', '完成分卷大纲'); service.store!.db.saveRun(run);
    await service.runner!.drive(run.id);
    const done = service.store!.db.run(run.id);
    assert.equal(done.status, 'awaiting_review', done.error ?? '应直接进入内容选择');
    assert.equal(done.rounds, 2); assert.equal(calls, 2); assert.equal(directoryReads, 1);
    assert.deepEqual(done.changes.map(change => change.path), [paths.volumes]);
    assert.equal(done.changes[0].content, submitted);
    assert.doesNotMatch(done.changes[0].content, /目录测试书|来源|命名解释/);
    assert.match(systems[1], /分卷命名：从真实目录/);
    const originalResearch = done.volumeNaming!.research;
    const rebuilt = service.rebuildRun(done, profile.id, '只改卷名');
    assert.deepEqual(rebuilt.volumeNaming!.research, originalResearch);
    assert.equal(calls, 2);
    const old = service.makeRun('stage', '旧任务'); delete old.volumeNaming;
    const rules = (service.runner as any).taskRules(old, p).system as string;
    assert.doesNotMatch(rules, /分卷命名：从真实目录/);
    const recovered = service.rebuildRun(old, profile.id, '恢复');
    assert.equal(recovered.volumeNaming, undefined);
    const renamed = service.rebuildRun(recovered, profile.id, '只改卷名，参考番茄风格');
    assert.deepEqual(renamed.volumeNaming, { version: 1, authorRevision: true });
    assert.deepEqual(renamed.changes, old.changes);
  } finally { service.close(); }
});
