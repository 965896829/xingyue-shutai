import test from 'node:test';
import { databaseVersion } from '../src/core/compatibility';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { FileStore, atomicWrite, safePath, proposalHash } from '../src/core/storage';
import { hash, newProject, paths, prosePath, countWords, updateConfigDocument, renderProgress } from '../src/core/domain';
import { initialFiles, systemPrompt } from '../src/core/skill';
import {
  factSchema,
  profileSchema,
  type Fact,
  type ModelResult,
  type Run,
  type SecretProfile
} from '../src/shared/types';
import { embeddingSettingsSchema, memoryScopeSchema } from '../src/shared/studio';
import { encodeFacts, validateEvidence, assembleContext } from '../src/core/memory';
import { retrieveMemory, scopedRead, traceSource, characterState } from '../src/core/memory-studio';
import { CompatibleEmbeddings, LocalCosine, proseChunks, SemanticIndex } from '../src/core/embeddings';
import {
  NarrativeTelemetry,
  requestGuard,
  recordUsage,
  syncUsage,
  recoverUsage
} from '../src/core/telemetry';
import { SkillRegistry } from '../src/core/skill-registry';
import { Service } from '../src/core/service';
import { RequestError } from '../src/core/provider';

const skill = path.resolve('resources/skill');
const model: SecretProfile = {
  ...profileSchema.parse({
    id: 'mock',
    name: 'fixture',
    model: 'mock',
    protocol: 'chat',
    baseUrl: 'http://127.0.0.1:1',
    contextLimit: 1000000,
    inputPrice: 1,
    outputPrice: 1
  }),
  apiKey: 'not-a-real-key'
};
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-studio-')),
    s = new FileStore(root),
    p = newProject('中文𠮷作品', root, {});
  p.revision = 1;
  s.commit(
    Object.entries(initialFiles(p, skill, '测试')).map(([path, content]) => ({
      path,
      content,
      baseHash: null
    })),
    p
  );
  return { s, p, root };
}
const body =
  '# 第一章\n\n𠮷阿宁左手受伤，玉钥仍在腰间。\n\n阿宁说：“钥匙已经烧毁。”阿甲对此信以为真。\n\n三日后必须归还玉钥。';
function fact(_s: FileStore, values: Partial<Fact> = {}): Fact {
  return factSchema.parse({
    id: 'f-injury',
    subject: '阿宁',
    aliases: ['小宁', '宁'],
    entityIds: ['ning'],
    predicate: '左手',
    value: '受伤',
    kind: 'event',
    category: 'injury',
    mandatory: true,
    reviewStatus: 'accepted',
    fromChapter: 1,
    revealedAt: 1,
    knowledge: [{ who: 'ning', mode: 'seen', fromChapter: 1 }],
    evidence: [{ path: prosePath(1), hash: hash(body), quote: '𠮷阿宁左手受伤，玉钥仍在腰间。' }],
    ...values
  });
}
function seed(s: FileStore, p: ReturnType<typeof newProject>, facts: Fact[]) {
  p.chapters[1] = 'complete';
  p.revision++;
  s.commit(
    [
      { path: prosePath(1), baseHash: s.db.document(prosePath(1))?.hash ?? null, content: body },
      {
        path: paths.items,
        baseHash: s.db.document(paths.items)!.hash,
        content: encodeFacts('# 物品与伤势', facts)
      }
    ],
    p
  );
}
function run(s: FileStore): Run {
  const p = s.db.project();
  return {
    id: 'run-' + Math.random(),
    stage: 'S10',
    chapter: 1,
    batch: p.batches[0],
    mode: 'stage',
    request: '测试',
    status: 'running',
    profileId: model.id,
    profileVersion: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    baseRevision: p.revision,
    baseSnapshotId: s.db.head()!.id,
    manifest: null,
    changes: [],
    facts: [],
    issues: [],
    messages: [],
    responseText: '',
    rounds: 0,
    toolCount: 0,
    usage: { input: 0, output: 0, cost: 0, currency: 'USD' },
    accepted: false,
    toolResults: {},
    pipeline: { phase: 'prose', epoch: 'epoch', version: 1, previewCalls: 0 }
  };
}
const response = (text: string): ModelResult => ({
  text,
  calls: [],
  native: {},
  stop: 'complete',
  usage: { input: 1, output: 1, cost: 0, currency: 'USD' }
});

test('P1：正文、事实、进度先原子提交；同步中断仍读取同一快照，外改保留，重试幂等', () => {
  const { s, p, root } = setup();
  try {
    const old = s.read(prosePath(1)),
      f = fact(s);
    p.chapters[1] = 'complete';
    p.revision++;
    assert.throws(
      () =>
        s.commit(
          [
            { path: prosePath(1), baseHash: old.hash, content: body },
            { path: paths.items, baseHash: s.read(paths.items).hash, content: encodeFacts('# 台账', [f]) }
          ],
          p,
          undefined,
          (point) => {
            if (point === 'after-database') throw new Error('断电');
          }
        ),
      /断电/
    );
    assert.equal(s.db.facts()[0].id, f.id);
    assert.equal(s.db.project().chapters[1], 'complete');
    assert.equal(s.readAccepted(prosePath(1)).content, body);
    assert.equal(s.read(prosePath(1)).content, old.content);
    const head = s.db.head()!;
    assert.equal(head.documents[prosePath(1)], hash(body));
    assert.equal(head.facts.length, 1);
    atomicWrite(safePath(root, prosePath(1)), '作者未确认改稿');
    s.recover();
    assert.equal(s.read(prosePath(1)).content, '作者未确认改稿');
    assert.equal(s.readAccepted(prosePath(1)).content, body);
    assert.equal(
      (s.db.sql.prepare("SELECT status FROM materialization_outbox WHERE status='conflict'").get() as any)
        .status,
      'conflict'
    );
    atomicWrite(safePath(root, prosePath(1)), old.content);
    s.materialize();
    s.recover();
    assert.equal(s.db.head()!.id, head.id);
    assert.equal(s.db.history(prosePath(1)).length, 2);
  } finally {
    s.close();
  }
});
test('P1：恢复时拒绝复用编号篡改变更载荷', () => {
  const { s, p, root } = setup();
  try {
    assert.throws(() =>
      s.commit(
        [{ path: paths.seed, content: '原批准内容', baseHash: s.read(paths.seed).hash }],
        { ...p, revision: 2 },
        undefined,
        (point) => {
          if (point === 'prepared') throw new Error('停止');
        }
      )
    );
    const folder = path.join(root, '.novelclient/transactions');
    const file = fs
      .readdirSync(folder)
      .map((f) => path.join(folder, f))
      .find((f) => JSON.parse(fs.readFileSync(f, 'utf8')).state === 'prepared')!;
    const journal = JSON.parse(fs.readFileSync(file, 'utf8'));
    journal.changes[0].newHash = s.putObject('偷换');
    fs.writeFileSync(file, JSON.stringify(journal));
    assert.throws(() => s.recover(), /变更集不一致/);
    assert.equal(s.db.project().revision, 1);
  } finally {
    s.close();
  }
});
test('M01/02/03/13/18：长期伤势、短化名、跨百章义务与精确来源不受 topK 限制', () => {
  const { s, p } = setup();
  try {
    const facts = Array.from({ length: 25 }, (_, i) => fact(s, { id: `f-${i}`, predicate: `持续约束${i}` }));
    seed(s, p, facts);
    const found = retrieveMemory(s, '小宁回归', { chapter: 120 }, 1);
    assert.equal(found.facts.length, 25);
    assert.ok(found.facts.every((f) => f.required));
    assert.equal(characterState(s, 'ning', { chapter: 120 }).facts.length, 25);
    assert.ok(characterState(s, 'ning', { chapter: 120 }).unknown.includes('item'));
  } finally {
    s.close();
  }
});
test('M04/09/10/11/12/35：世界、时间线、认知、角色直读和项目隔离', () => {
  const { s, p } = setup();
  try {
    const f = fact(s),
      other = fact(s, { id: 'other', worldId: 'other', value: '毫发无伤' }),
      belief = fact(s, {
        id: 'lie',
        kind: 'belief',
        predicate: '钥匙',
        value: '已烧毁',
        category: 'knowledge',
        entityIds: ['jia'],
        subject: '阿甲',
        knowledge: [{ who: 'jia', mode: 'misunderstood', fromChapter: 1 }]
      }),
      future = fact(s, { id: 'future', revealedAt: 20, knowledge: [] }),
      past = fact(s, { id: 'past', timelineId: 'past', storyTime: '未知' });
    seed(s, p, [f, other, belief, future, past]);
    const scope = memoryScopeSchema.parse({ chapter: 2, viewpoint: 'character', characterId: 'jia' });
    const found = retrieveMemory(s, '阿甲', scope);
    assert.deepEqual(
      found.facts.map((x) => x.fact.kind),
      ['belief']
    );
    assert.equal(found.facts[0].fact.knowledge[0].mode, 'misunderstood');
    assert.throws(() => scopedRead(s, paths.roles, scope), /视角/);
    assert.throws(() => scopedRead(s, prosePath(3), scope), /读取范围/);
    assert.equal(retrieveMemory(s, '阿宁', { chapter: 2, worldId: 'other' }).facts[0].fact.id, 'other');
    assert.throws(() => retrieveMemory(s, '阿宁', { chapter: 2, snapshotId: 'foreign' }), /快照不可用/);
    assert.equal(
      retrieveMemory(s, '阿宁', { chapter: 2, timelineId: 'past' }).facts[0].fact.storyTime,
      '未知'
    );
  } finally {
    s.close();
  }
});
test('M06/07/08/19/20：改稿失效、历史回看、Unicode 证据位置及原始版本定位', () => {
  const { s, p } = setup();
  try {
    const f = fact(s);
    seed(s, p, [f]);
    assert.deepEqual(validateEvidence(s, f, 2), []);
    assert.equal(
      Array.from(body).slice(f.evidence[0].start, f.evidence[0].end).join(''),
      f.evidence[0].quote
    );
    const historic = s.db.head()!.id;
    p.revision++;
    s.commit([{ path: prosePath(1), baseHash: hash(body), content: body.replace('受伤', '无伤') }], p);
    assert.equal(retrieveMemory(s, '宁', { chapter: 2 }).facts.length, 0);
    assert.equal(
      retrieveMemory(s, '宁', { chapter: 2, mode: 'historical', snapshotId: historic }).facts.length,
      1
    );
    assert.equal(traceSource(s, f.evidence[0]).content, body);
    const bad = structuredClone(f);
    bad.evidence[0].start = 1;
    assert.ok(validateEvidence(s, bad, 2).length);
    assert.ok(s.db.sql.prepare('SELECT * FROM review_queue').all().length);
  } finally {
    s.close();
  }
});
test('M14/15/16/17/21：索引降级可见、未命中、冲突保留与完整请求预算', async () => {
  const { s, p } = setup();
  try {
    seed(s, p, [fact(s), fact(s, { id: 'conflict', value: '痊愈' })]);
    const found = retrieveMemory(s, '阿宁', { chapter: 3 });
    assert.equal(found.status, 'conflict');
    assert.equal(found.facts.length, 0);
    assert.equal(found.issues.length, 2);
    assert.equal(characterState(s, 'ning', { chapter: 3 }).facts.length, 0);
    assert.equal(retrieveMemory(s, '无关名字', { chapter: 0 }).status, 'not_found');
    const index = new SemanticIndex(
      s,
      () => ({
        settings: embeddingSettingsSchema.parse({ enabled: true, model: 'mock' }),
        apiKey: 'fixture'
      }),
      () => {}
    );
    assert.equal(
      (await index.retrieve('阿宁', memoryScopeSchema.parse({ chapter: 3 }))).semantic,
      'degraded'
    );
    const r = run(s),
      small = { ...model, contextLimit: 2000, outputLimit: 512 };
    assert.throws(
      () => requestGuard(small, '中'.repeat(2000), [{ role: 'user', content: 'x' }], [], r, null),
      /容量/
    );
    assert.throws(
      () => requestGuard(model, '正常', [{ role: 'user', content: '正常' }], [], r, 0),
      /费用上限/
    );
    assert.throws(() => assembleContext(s, p, 'S10', '阿宁', model), /记忆来源|缺少本阶段/);
  } finally {
    s.close();
  }
});
test('M24/28/29/30/32：迟到评估拒收，未知保持 null，低分保留证据与量表版本', async () => {
  const { s } = setup();
  try {
    const r = run(s);
    let release!: (v: ModelResult) => void,
      calls = 0;
    const telemetry = new NarrativeTelemetry(
      s,
      () => {},
      async () => {
        calls++;
        if (calls === 1)
          return new Promise<ModelResult>((resolve) => {
            release = resolve;
          });
        return response(
          JSON.stringify({
            values: { pressure: 1, payoff: null, emotion: 2, revelation: null, relationship: 4 },
            quotes: ['新文本'],
            note: '关系推进'
          })
        );
      }
    );
    const old = telemetry.final(r, '旧文本', model);
    r.pipeline!.version++;
    const currentJob = telemetry.final(r, '新文本', model);
    assert.equal(calls, 1, '新评估必须等待旧请求结束');
    release(
      response(
        JSON.stringify({
          values: { pressure: 5, payoff: 5, emotion: 5, revelation: 5, relationship: 5 },
          quotes: ['旧文本'],
          note: '旧'
        })
      )
    );
    assert.equal(await old, null);
    const current = await currentJob;
    assert.equal(current!.values.payoff, null);
    assert.equal(current!.values.pressure, 1);
    assert.equal(current!.rubric, 'narrative-1');
    assert.equal(s.db.sql.prepare('SELECT * FROM assessments').all().length, 1);
    await telemetry.stop();
  } finally {
    s.close();
  }
});

test('后台评估仅遇到预算变更仍保留结果，遇到创作约束变更则拒收', async () => {
  for (const storyChanged of [false, true]) {
    const { s } = setup();
    let release!: (v: ModelResult) => void;
    const telemetry = new NarrativeTelemetry(s, () => {}, async () => new Promise<ModelResult>(resolve => { release = resolve; }));
    try {
      const r = run(s);
      const pending = telemetry.final(r, '角色冒险修复设备。', model);
      const p = s.db.project();
      p.config.maxRounds = 30;
      if (storyChanged) p.config.constraints = '禁止角色冒险';
      p.revision++;
      s.commit([
        { path: paths.config, baseHash: s.db.document(paths.config)!.hash, content: updateConfigDocument(s.readAccepted(paths.config).content, p) },
        { path: paths.progress, baseHash: s.db.document(paths.progress)!.hash, content: renderProgress(p) }
      ], p);
      release(response(JSON.stringify({ values: { pressure: 3, payoff: null, emotion: null, revelation: null, relationship: null }, quotes: ['角色冒险修复设备'], note: '离线证据评估' })));
      const result = await pending;
      if (storyChanged) assert.equal(result, null);
      else assert.equal(result!.values.pressure, 3);
    } finally { await telemetry.stop(); s.close(); }
  }
});
test('M26：只在完整段落边界评估，未完成尾句不进入请求', async (t) => {
  const { s } = setup();
  try {
    const r = run(s);
    let received = '';
    const telemetry = new NarrativeTelemetry(
      s,
      () => {},
      async (_p, _s, messages) => {
        received = messages[0].content;
        return response(
          JSON.stringify({
            values: { pressure: null, payoff: null, emotion: null, revelation: null, relationship: null },
            quotes: [],
            note: ''
          })
        );
      }
    );
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.timers.setTime(20000);
    telemetry.checkpoint(r, '完成段落。'.repeat(15) + '\n\n他并没有', model);
    t.mock.timers.tick(1200);
    await Promise.resolve();
    await Promise.resolve();
    assert.ok(received.includes('完成段落'));
    assert.ok(!received.includes('他并没有'));
    await telemetry.stop();
    t.mock.timers.reset();
  } finally {
    s.close();
  }
});
test('M33/36：Embedding 契约、维度检查与独立 Key；不重定向认证', async () => {
  const requests: any[] = [];
  const server = createServer((req, res) => {
    let bytes = '';
    req.on('data', (b) => (bytes += b));
    req.on('end', () => {
      requests.push({ url: req.url, authorization: req.headers.authorization, body: JSON.parse(bytes) });
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ index: 0, embedding: [1, 0, 0] }], usage: { total_tokens: 2 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as any).port;
  try {
    const settings = embeddingSettingsSchema.parse({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      model: 'embedding-only',
      dimensions: 3
    });
    const client = new CompatibleEmbeddings(settings, 'independent-key');
    assert.equal((await client.embed(['文本'], new AbortController().signal)).vectors[0].length, 3);
    assert.equal(requests[0].url, '/v1/embeddings');
    assert.equal(requests[0].body.encoding_format, 'float');
    assert.equal(requests[0].body.dimensions, undefined);
    assert.equal(requests[0].authorization, 'Bearer independent-key');
    await assert.rejects(
      new CompatibleEmbeddings({ ...settings, dimensions: 4 }, 'key').embed(
        ['文本'],
        new AbortController().signal
      ),
      /维度/
    );
    await assert.rejects(client.embed(['中'.repeat(10000)], new AbortController().signal), /预算/);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
test('M05/06/36/37：向量仅收正式源、局部更新、版本先过滤和代次隔离', async () => {
  const { s, p } = setup();
  try {
    seed(s, p, [fact(s)]);
    let calls = 0,
      settings = embeddingSettingsSchema.parse({ enabled: true, model: 'embedding-one', dimensions: 3 });
    const index = new SemanticIndex(
      s,
      () => ({ settings, apiKey: 'fixture' }),
      () => {},
      {
        embed: async (input) => {
          calls++;
          return { vectors: input.map(() => [1, 0, 0]), tokens: 1 };
        }
      }
    );
    const first = await index.rebuild();
    assert.equal(first.status, 'ready');
    const before = calls;
    await index.rebuild();
    assert.equal(calls, before);
    const candidate = s.putObject('候选死亡');
    assert.equal(s.db.sql.prepare('SELECT 1 FROM vector_chunks WHERE hash=?').get(candidate), undefined);
    const old = s.db.head()!.id;
    p.revision++;
    s.commit([{ path: prosePath(1), baseHash: hash(body), content: body + '新段落。' }], p);
    const current = await index.retrieve('新段落', memoryScopeSchema.parse({ chapter: 1 }));
    assert.ok(current.documents.every((d) => d.hash !== hash(body)));
    await index.rebuild();
    assert.ok(calls > before);
    settings = { ...settings, model: 'embedding-two' };
    const second = await index.rebuild();
    assert.notEqual(first.generation, second.generation);
    assert.deepEqual(
      new LocalCosine()
        .rank(
          [1, 0],
          [
            { id: 'x', vector: [1, 0] },
            { id: 'wrong', vector: [1, 0, 0] }
          ],
          10
        )
        .map((r) => r.id),
      ['x']
    );
    assert.ok(s.db.snapshot(old).documents[prosePath(1)] === hash(body));
  } finally {
    s.close();
  }
});
test('P0/M34/38：26 个锁定技能、宿主权限、按需规则、中文码点与跨千章', () => {
  const registry = new SkillRegistry(skill);
  assert.equal(registry.entries.length, 26);
  for (const entry of registry.entries) {
    const loaded = registry.load(entry.id);
    assert.ok(loaded.content.length);
    assert.ok(!entry.tools.some((t) => /terminal|shell|approve|commit/.test(t)));
  }
  assert.throws(() => registry.load('../outside'), /未知技能/);
  const p = newProject('x', 'x', {});
  assert.ok(Buffer.byteLength(systemPrompt(skill, p, 'S10')) < 84327);
  assert.equal(countWords('\n\n# 章名\n\n甲𠮷😀'), 3);
  assert.equal(prosePath(1000), '07_正文章节/第1000章.md');
  for (const c of proseChunks('𠮷😀测试\n\n'.repeat(40), 30))
    assert.equal(Array.from('𠮷😀测试\n\n'.repeat(40)).slice(c.start, c.end).join(''), c.text);
});
test('P1：未绑定的批准、旧内容批准、过期快照均不能接受', async () => {
  const service = new Service(skill, () => {});
  try {
    await service.invoke('project.create', {
      parent: fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-approval-')),
      title: '绑定',
      premise: '测试'
    });
    const id = await service.invoke('document.save', {
      path: paths.seed,
      content: '# 修订',
      baseHash: service.store!.db.document(paths.seed)!.hash
    });
    assert.equal(typeof id, 'string');
    if (typeof id !== 'string') throw new Error('Expected run ID');
    const r = service.store!.db.run(id);
    await assert.rejects(service.invoke('run.accept', { id }));
    const old = r.proposalHash;
    r.changes[0].content = '# 新修订';
    service.store!.db.saveRun(r);
    await assert.rejects(service.invoke('run.accept', { id, proposalHash: old }), /内容已改变/);
    assert.notEqual(proposalHash(r), old);
    assert.equal(service.store!.db.project().revision, 1);
  } finally {
    service.close();
  }
});

test('分类浏览先过滤再分页，不丢失 topK 之外的记录', () => {
  const { s, p } = setup();
  try {
    seed(
      s,
      p,
      Array.from({ length: 125 }, (_, i) =>
        fact(s, {
          id: `item-${i.toString().padStart(3, '0')}`,
          category: i < 90 ? 'character' : 'item',
          mandatory: false,
          predicate: `记录${i}`
        })
      )
    );
    const first = retrieveMemory(s, '', { chapter: 2 }, 20, { category: 'item', offset: 0, pageSize: 20 });
    const second = retrieveMemory(s, '', { chapter: 2 }, 20, { category: 'item', offset: 20, pageSize: 20 });
    assert.equal(first.total, 35);
    assert.equal(first.facts.length, 20);
    assert.equal(first.hasMore, true);
    assert.equal(second.facts.length, 15);
    assert.equal(second.hasMore, false);
    assert.equal(new Set([...first.facts, ...second.facts].map((x) => x.fact.id)).size, 35);
  } finally {
    s.close();
  }
});

test('预览次数跨任务重载保留，未知费用会阻止预算内追加请求', async (t) => {
  const { s } = setup();
  let telemetry: NarrativeTelemetry | undefined;
  try {
    const p = s.db.project();
    p.config.preview.maxCalls = 1;
    s.db.set('project', p);
    const r = run(s);
    s.db.saveRun(r);
    let calls = 0;
    const caller = async () => {
      calls++;
      throw new RequestError('回执未知', true);
    };
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    t.mock.timers.setTime(20000);
    telemetry = new NarrativeTelemetry(s, () => {}, caller);
    telemetry.checkpoint(r, '完整段落。'.repeat(20) + '\n\n尾句', model);
    t.mock.timers.tick(1200);
    await Promise.resolve();
    await Promise.resolve();
    await telemetry.stop();
    assert.equal(calls, 1);
    assert.equal(s.db.run(r.id).usage.cost, null);
    telemetry = new NarrativeTelemetry(s, () => {}, caller);
    telemetry.checkpoint(s.db.run(r.id), '新的段落。'.repeat(20) + '\n\n尾句', model);
    t.mock.timers.tick(10000);
    await Promise.resolve();
    await Promise.resolve();
    await telemetry.stop();
    assert.equal(calls, 1);
    syncUsage(s, r);
    assert.throws(() => requestGuard(model, 'x', [], [], r, 1), /费用未知/);
  } finally {
    await telemetry?.stop();
    t.mock.timers.reset();
    s.close();
  }
});

test('语义事实隔离与查询费用回执，检索和写作费用共同累计', async () => {
  const { s, p } = setup();
  try {
    seed(s, p, [
      fact(s, { id: 'visible', mandatory: false, category: 'item' }),
      fact(s, { id: 'hidden', mandatory: false, category: 'item', worldId: 'other' })
    ]);
    let calls = 0;
    const settings = embeddingSettingsSchema.parse({
      enabled: true,
      model: 'mock',
      dimensions: 2,
      price: 2,
      dataScope: 'prose-and-memory'
    });
    const index = new SemanticIndex(
      s,
      () => ({ settings, apiKey: 'fixture' }),
      () => {},
      {
        embed: async () => {
          calls++;
          return { vectors: [[1, 0]], tokens: 10 };
        }
      }
    );
    await index.rebuild();
    const built = calls;
    await index.rebuild();
    assert.equal(calls, built);
    const result = await index.retrieve('未知同义词', memoryScopeSchema.parse({ chapter: 2 }), 20, {
      remaining: 1,
      currency: 'USD'
    });
    assert.ok(result.facts.some((x) => x.fact.id === 'visible'));
    assert.ok(!result.facts.some((x) => x.fact.id === 'hidden'));
    assert.equal(result.usage?.cost, 0.00002);
    const r = run(s);
    s.db.saveRun(r);
    recordUsage(s, r, result.usage!, {
      phase: 'retrieval',
      profileId: 'embedding',
      profileVersion: 1,
      usage: result.usage!
    });
    recordUsage(
      s,
      r,
      { input: 20, output: 3, cost: 0.01, currency: 'USD' },
      {
        phase: 'writing',
        profileId: 'mock',
        profileVersion: 1,
        usage: { input: 20, output: 3, cost: 0.01, currency: 'USD' }
      }
    );
    assert.equal(s.db.run(r.id).usage.input, 30);
    assert.equal(s.db.run(r.id).steps?.length, 2);
    const before = calls;
    assert.equal(
      (
        await index.retrieve('未知同义词', memoryScopeSchema.parse({ chapter: 2 }), 20, {
          remaining: 0,
          currency: 'USD'
        })
      ).semantic,
      'budget-limited'
    );
    assert.equal(calls, before);
  } finally {
    s.close();
  }
});

test('旧版未接受正文迁移为复核候选，已接受正文保持 S11 待更新', async () => {
  const { s, p, root } = setup();
  p.stage = 'S10';
  s.db.set('project', p);
  const old = run(s);
  delete old.baseSnapshotId;
  delete old.pipeline;
  old.status = 'awaiting_review';
  old.changes = [{ path: prosePath(1), baseHash: s.db.document(prosePath(1))!.hash, content: body }];
  s.db.saveRun(old);
  s.close();
  const service = new Service(skill, () => {});
  try {
    service.open(root);
    const migrated = service.store!.db.run(old.id);
    assert.equal(migrated.pipeline?.phase, 'review');
    assert.equal(migrated.changes[0].content, body);
    assert.equal(migrated.status, 'paused');
    const accepted = { ...migrated, id: 'already-accepted', accepted: true, status: 'complete' as const };
    delete accepted.pipeline;
    delete accepted.baseSnapshotId;
    service.store!.db.saveRun(accepted);
    const p = service.store!.db.project();
    p.stage = 'S11';
    service.store!.db.set('project', p);
    service.close();
    service.open(root);
    assert.equal(service.store!.db.project().stage, 'S11');
    assert.equal(service.store!.db.run(accepted.id).pipeline, undefined);
  } finally {
    service.close();
  }
});

test('独立研究只接受报告，不登记书内事实或推进章节', async () => {
  let service: Service;
  service = new Service(
    skill,
    () => {},
    async (_p, _s, messages) =>
      messages.at(-1)?.role === 'tool'
        ? response('完成')
        : {
            ...response(''),
            stop: 'tools',
            calls: [
              {
                id: 'report',
                name: 'propose_changes',
                arguments: JSON.stringify({
                  changes: [
                    {
                      path: '11_创作研究/连续性核对.md',
                      content: '# 连续性核对\n\n缺少足够资料，暂不判断。',
                      baseHash: null
                    }
                  ]
                })
              }
            ]
          }
  );
  service.profiles = [model];
  try {
    await service.invoke('project.create', {
      parent: fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-research-')),
      title: '独立研究',
      premise: '测试'
    });
    const before = service.store!.db.project();
    const id = await service.invoke('skill.run', {
      skillId: 'webnovel-continuity-audit',
      request: '核对现有资料',
      profileId: model.id
    });
    while (service.runner!.controller) await new Promise((r) => setTimeout(r, 10));
    assert.equal(typeof id, 'string');
    if (typeof id !== 'string') throw new Error('Expected run ID');
    const r = service.store!.db.run(id);
    assert.equal(r.status, 'awaiting_review', r.error ?? '');
    assert.equal(r.facts.length, 0);
    await service.invoke('run.accept', { id, proposalHash: r.proposalHash, startNext: false });
    const after = service.store!.db.project();
    assert.equal(after.stage, before.stage);
    assert.equal(after.chapter, before.chapter);
    assert.deepEqual(after.chapters, before.chapters);
    assert.equal(service.store!.db.facts().length, 0);
  } finally {
    service.close();
  }
});

test('进程中断后未结算评估记为未知费用，恢复处理幂等', () => {
  const { s } = setup();
  try {
    const r = run(s);
    r.status = 'awaiting_review';
    s.db.saveRun(r);
    s.db.set(`assessmentInflight:${r.id}`, {
      profileId: model.id,
      profileVersion: model.version,
      currency: model.currency
    });
    recoverUsage(s);
    assert.equal(s.db.run(r.id).usage.cost, null);
    assert.equal(s.db.run(r.id).status, 'awaiting_review');
    assert.equal(s.db.run(r.id).steps?.length, 1);
    recoverUsage(s);
    assert.equal(s.db.run(r.id).steps?.length, 1);
  } finally {
    s.close();
  }
});

test('v2 升级备份包含正文、历史数据库和封面附件', () => {
  const { s, root } = setup();
  const bytes = Buffer.from([137, 80, 78, 71, 0, 255, 37]);
  atomicWrite(path.join(root, '10_封面/自选封面.png'), bytes);
  s.db.set('upgrade-marker', 'before');
  s.db.sql.exec('PRAGMA user_version=2');
  s.close();
  const opened = new FileStore(root);
  try {
    const name = fs.readdirSync(root).find((n) => n.startsWith(`.novelclient.before-v${databaseVersion}-`))!;
    const backup = path.join(root, name);
    assert.deepEqual(fs.readFileSync(path.join(backup, '10_封面/自选封面.png')), bytes);
    assert.equal(
      fs.readFileSync(path.join(backup, paths.seed), 'utf8'),
      opened.readAccepted(paths.seed).content
    );
    const manifest = JSON.parse(fs.readFileSync(path.join(backup, 'wenxu-backup.json'), 'utf8'));
    assert.ok(
      manifest.manifest.some((e: any) => e.path === '10_封面/自选封面.png' && e.hash === hash(bytes))
    );
    const saved = new DatabaseSync(path.join(backup, '.novelclient/state.sqlite'), { readOnly: true });
    assert.equal(saved.prepare('PRAGMA user_version').get()!.user_version, 2);
    saved.close();
    assert.equal(opened.db.get('upgrade-marker'), 'before');
  } finally {
    opened.close();
  }
});
