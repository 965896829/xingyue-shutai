import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStore, safePath, atomicWrite } from '../src/core/storage';
import {
  newProject,
  advance,
  activeBatch,
  chapterTag,
  countWords,
  hash,
  reconfigure,
  updateConfigDocument,
  paths,
  renderConfig,
  stageOutputs,
  prosePath,
  batchPath,
  rhythmPath,
  worldRequiredFields,
  behaviorRequiredFields
} from '../src/core/domain';
import { profileSchema, factSchema, type SecretProfile, type ModelResult } from '../src/shared/types';
import { templates, initialFiles, systemPrompt } from '../src/core/skill';
import { validateCandidate, checkFields, checkWorldFields, validateCoverage } from '../src/core/validation';
import {
  rebuildMemory,
  encodeFacts,
  searchMemory,
  validateEvidence,
  assembleContext
} from '../src/core/memory';
import { Service } from '../src/core/service';
import { importDocument, exportDocument, createBackup, restoreBackup } from '../src/core/documents';
import { DatabaseSync } from 'node:sqlite';
import { boundedBody } from '../src/core/provider';
import { classifyProjectLock, parseProjectLock, processStartedAt } from '../src/core/project-lock';
const skill = path.resolve('resources/skill');

test('作品锁区分进程编号复用、真正存活的持有者和无法查询的进程', () => {
  const start = Date.UTC(2026, 9, 21, 3);
  const old = { pid: 123, createdAt: '2026-10-10T03:46:55.784Z' };
  assert.equal(classifyProjectLock(old, { presence: 'alive', startedAt: start }), 'stale');
  assert.equal(classifyProjectLock({ ...old, createdAt: new Date(start + 2000).toISOString() }, { presence: 'alive', startedAt: start }), 'active');
  assert.equal(classifyProjectLock({ ...old, processStartedAt: start }, { presence: 'alive', startedAt: start }), 'active');
  assert.equal(classifyProjectLock({ ...old, processStartedAt: start - 10000 }, { presence: 'alive', startedAt: start }), 'stale');
  assert.equal(classifyProjectLock(old, { presence: 'exited' }), 'stale');
  assert.equal(classifyProjectLock(old, { presence: 'unknown', startedAt: start }), 'unknown');
  assert.equal(classifyProjectLock(old, { presence: 'alive' }), 'unknown');
  assert.equal(classifyProjectLock({ pid: 123 }, { presence: 'alive', startedAt: start }), 'active');
  assert.equal(classifyProjectLock({ ...old, createdAt: 'unreadable' }, { presence: 'alive', startedAt: start }), 'active');
  for (const raw of ['null', '{"pid":0}', '{"pid":-1}', '{"pid":"123"}', '{"pid":123,"processStartedAt":0}'])
    assert.throws(() => parseProjectLock(raw), /锁身份无效/);
});

test('旧作品遗留锁的 PID 被复用后可恢复，新锁仍阻止重复打开且正常关闭释放', () => {
  const { s, root } = setup();
  const before = s.read(paths.seed).content;
  const revision = s.db.project().revision;
  s.close();
  const lock = path.join(root, '.novelclient/write-lock.json');
  const startedAt = processStartedAt(process.pid);
  assert.ok(startedAt && startedAt < Date.now());
  for (const extra of [{}, { nonce: 'old-runtime', startedAt: 1 }, { processStartedAt: startedAt - 100000 }]) {
    fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, createdAt: '2000-01-01T00:00:00.000Z', ...extra }));
    const reopened = new FileStore(root);
    try {
      const current = JSON.parse(fs.readFileSync(lock, 'utf8'));
      assert.equal(current.processStartedAt, startedAt);
      assert.notEqual(current.nonce, 'old-runtime');
      assert.throws(() => new FileStore(root), /另一个窗口/);
      assert.equal(reopened.read(paths.seed).content, before);
      assert.equal(reopened.db.project().revision, revision);
    } finally { reopened.close(); }
    assert.equal(fs.existsSync(lock), false);
  }
});

test('章后行为日志只检查本章人物记录，明确未变化说明不强制虚构八项更新', () => {
  const p = newProject('行为日志', 'unused', {});
  const role = '### 陈舟\n' + behaviorRequiredFields.map(field => `- ${field}：按原文记录并保留尚未完成的承诺`).join('\n');
  const unchanged = '### 房东、师父、原维修者\n本章仅通过既有背景被提及，未新增本人行动、心情、获知或态度。保留原人物字段，不假更新。';
  const check = (content: string) => validateCandidate('S11', p, [{ path: paths.behavior, content, baseHash: null }], skill, 'revision').filter(issue => issue.path === paths.behavior);
  assert.deepEqual(check(`# 情绪与行为记忆\n## 第001章\n${role}\n${unchanged}\n## 第002—003章记录规则\n### 计划说明\n尚无正文，不登记行为。`), []);
  assert.deepEqual(check(`# 情绪与行为记忆\n## 第001章\n${role}\n## 本章未变化角色\n${unchanged}`), []);
  assert.ok(check(`# 情绪与行为记忆\n## 第001章\n### 陈舟\n保留原状态。`).some(issue => issue.code === 'missing_field'));
  assert.ok(check(`# 情绪与行为记忆\n## 第001章\n${unchanged}\n- 本章情绪：未知`).some(issue => issue.code === 'missing_field'));
  assert.ok(check(`# 情绪与行为记忆\n## 第002章\n${role}`).some(issue => issue.code === 'behavior_chapter'));
});
test('响应边读边限制大小，超过上限立即取消', async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      c.enqueue(new Uint8Array(8));
    },
    cancel() {
      cancelled = true;
    }
  });
  await assert.rejects(boundedBody(stream, 10), /大小上限/);
  assert.equal(cancelled, true);
});
test('终端中文输出完整且不混入 CLIXML', async () => {
  const { s } = setup();
  const { AgentRunner } = await import('../src/core/runner');
  try {
    const runner = new AgentRunner(
      s,
      skill,
      () => [],
      () => {}
    );
    const result = (await runner.terminal(
      process.platform === 'win32' ? "Write-Output '中文回执'" : "printf '中文回执'",
      new AbortController().signal
    )) as { code: number; output: string };
    assert.equal(result.code, 0);
    assert.match(result.output, /中文回执/);
    assert.doesNotMatch(result.output, /CLIXML/);
  } finally {
    s.close();
  }
});
test('未规划批次允许缩短；参数更新保留作者备注与未知 Markdown', () => {
  const p = newProject('参数', 'x', {});
  const c = { ...p.config, targetWords: 25000, batchSize: 10 };
  const next = reconfigure(p, c);
  assert.equal(activeBatch(next).end, 10);
  const notes = '\r\n## 作者自由备注\r\n| 不可丢 | 特殊内容 |\r\n<!-- 注释保留 -->\r\n';
  const text = updateConfigDocument(renderConfig(p).replaceAll('\n', '\r\n') + notes, next);
  assert.ok(text.includes(notes));
  assert.match(text, /目标总字数：25000/);
});
test('未来数据库版本拒绝打开且不覆盖版本号', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-future-'));
  fs.mkdirSync(path.join(root, '.novelclient'));
  const file = path.join(root, '.novelclient/state.sqlite');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA user_version=99');
  db.close();
  assert.throws(() => new FileStore(root), /高于/);
  const check = new DatabaseSync(file);
  assert.equal(check.prepare('PRAGMA user_version').get()!.user_version, 99);
  check.close();
});
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-test-'));
  const s = new FileStore(root),
    p = newProject('测试作品', root, {});
  p.revision = 1;
  s.commit(
    Object.entries(initialFiles(p, skill, '原始设定')).map(([path, content]) => ({
      path,
      content,
      baseHash: null
    })),
    p
  );
  return { s, p, root };
}
test('章长 Unicode、跨千章编号、冻结批次和末批', () => {
  assert.equal(countWords('# 第001章\r\n你 好\n𠮷😀'), 4);
  assert.equal(chapterTag(1000), '第1000章');
  let p = newProject('四十章', 'unused', { targetWords: 100000, batchSize: 30 });
  assert.equal(activeBatch(p).end, 30);
  p.chapter = 30;
  p.stage = 'S11';
  p.config.batchSize = 20;
  p = advance(p, 'r');
  assert.deepEqual([p.chapter, p.stage, activeBatch(p).start, activeBatch(p).end], [31, 'S06', 31, 40]);
  assert.equal(p.batches[0].sizeAtCreation, 30);
});
test('路径穿越、重复索引别名和单写者保护', () => {
  const { s, p, root } = setup();
  try {
    for (const f of [
      '../outside.md',
      'C:/outside',
      'x/../y',
      '.novelclient/state.sqlite',
      'CON.md',
      'x./y.md'
    ])
      assert.throws(() => safePath(root, f));
    assert.throws(() => new FileStore(root), /另一个/);
    assert.throws(
      () =>
        s.commit(
          [
            {
              path: paths.seed.replaceAll('/', '\\'),
              content: '别名不得创建',
              baseHash: s.read(paths.seed).hash
            }
          ],
          p
        ),
      /正斜杠/
    );
  } finally {
    s.close();
  }
});
test('外部改稿冲突保留磁盘字节', () => {
  const { s, p, root } = setup();
  try {
    const before = s.read(paths.seed);
    atomicWrite(safePath(root, paths.seed), '# 作者外改\n不能覆盖');
    assert.throws(
      () => s.commit([{ path: paths.seed, baseHash: before.hash, content: 'AI新稿' }], { ...p, revision: 2 }),
      /外部修改/
    );
    assert.match(s.read(paths.seed).content, /不能覆盖/);
    assert.equal(s.db.project().revision, 1);
  } finally {
    s.close();
  }
});
for (const point of ['prepared', `file:${paths.seed}`, 'before-database', 'after-database'])
  test(`事务在 ${point} 崩溃后可恢复且不重复`, () => {
    const { s, p, root } = setup();
    const change = { path: paths.seed, baseHash: s.read(paths.seed).hash, content: '# 新设定\n正文内容' };
    assert.throws(
      () =>
        s.commit([change], { ...p, revision: 2 }, undefined, (x) => {
          if (x === point) throw new Error('模拟断电');
        }),
      /模拟断电/
    );
    s.close();
    const recovered = new FileStore(root);
    try {
      recovered.recover();
      assert.equal(recovered.read(paths.seed).content, change.content);
      assert.equal(recovered.db.project().revision, 2);
      recovered.recover();
      assert.equal(recovered.db.history(paths.seed).length, 2);
    } finally {
      recovered.close();
    }
  });
test('正式事实保留旧伤、中文短名与未知；修改证据使事实争议', () => {
  const { s, p } = setup();
  try {
    const body = '# 第一章\n阿宁左手骨折，尚未治疗。';
    s.commit([{ path: prosePath(1), baseHash: s.read(prosePath(1)).hash, content: body }], p);
    const fact = factSchema.parse({
      id: 'injury-1',
      subject: '阿宁',
      aliases: ['宁'],
      predicate: '左手',
      value: '骨折，尚未治疗',
      kind: 'event',
      category: 'injury',
      mandatory: true,
      fromChapter: 1,
      revealedAt: 1,
      reviewStatus: 'accepted',
      evidence: [{ path: prosePath(1), hash: hash(body), quote: '阿宁左手骨折，尚未治疗。' }]
    });
    s.commit(
      [
        {
          path: paths.items,
          baseHash: s.read(paths.items).hash,
          content: encodeFacts(s.read(paths.items).content, [fact])
        }
      ],
      p
    );
    assert.equal(rebuildMemory(s).issues.length, 0);
    const found = searchMemory(s, '宁重新出场', 300, 1);
    assert.equal(found.facts[0].fact.id, 'injury-1');
    assert.equal(found.facts[0].required, true);
    assert.equal(searchMemory(s, '宁', 0).facts.length, 0);
    s.commit([{ path: prosePath(1), baseHash: hash(body), content: '# 第一章\n阿宁毫发无伤。' }], {
      ...p,
      revision: 2
    });
    assert.ok(rebuildMemory(s).issues.length);
    assert.equal(searchMemory(s, '阿宁', 2).facts.length, 0);
    assert.equal(s.db.facts()[0].reviewStatus, 'disputed');
  } finally {
    s.close();
  }
});
test('计划不冒充事件、摘要不能自证、未找到不当不存在', () => {
  const { s, p } = setup();
  try {
    const f = factSchema.parse({
      id: 'f',
      subject: '甲',
      predicate: '得知',
      value: '秘密',
      kind: 'event',
      category: 'knowledge',
      fromChapter: 20,
      revealedAt: 20,
      evidence: [{ path: paths.summary, hash: s.read(paths.summary).hash, quote: '批次人物摘要' }]
    });
    assert.ok(validateEvidence(s, f, 1).length >= 2);
    assert.equal(searchMemory(s, '不存在的唯一名字', 1).status, 'not_found');
    const p2 = { ...p, root: 'x' };
    assert.throws(
      () =>
        assembleContext(
          s,
          p2,
          'S01',
          'x',
          profileSchema.parse({
            id: 'p',
            name: 'p',
            baseUrl: 'https://example.test/v1',
            protocol: 'chat',
            model: 'm',
            contextLimit: 1024,
            outputLimit: 128
          })
        ),
      /预算/
    );
  } finally {
    s.close();
  }
});
test('全部批次覆盖、非法强度、空字段不可通过', () => {
  const p = newProject('x', 'x', { targetWords: 5000, batchSize: 2 });
  assert.equal(checkFields('- 原始设定：\n', ['原始设定'], 'x').length, 1);
  assert.equal(checkFields('- 原始设定：\n- 题材类型：玄幻\n', ['原始设定'], 'x').length, 1);
  assert.equal(checkFields('- 情节强度：/5\n', ['情节强度'], 'x').length, 1);
  assert.equal(validateCoverage('## 第999章：甲\n## 第1000章：乙', 999, 1000, 'x').length, 0);
  assert.ok(validateCoverage('## 第001章：空\n## 第001章：重复', 1, 2, 'x').length);
  const bad = validateCandidate(
    'S08',
    p,
    [
      {
        path: batchPath(activeBatch(p)),
        content: '## 第001章：空\n- 情节强度：9\n## 第002章：空',
        baseHash: null
      }
    ],
    skill
  );
  assert.ok(bad.some((i) => i.code === 'intensity'));
  assert.ok(bad.some((i) => i.code === 'missing_field'));
});

test('世界规则接受编号章节、组合标题和列表字段，仍拦截空章节与只在正文提及的字段', () => {
  const labels = ['世界底层规则', '主角金手指', '金手指限制', '使用代价', '信息差', '敌人反制方式', '体系升级空间', '中后期防重复机制'];
  const headings = ['一、世界底层规则', '主角金手指', '三、金手指限制与核心待确认细则', '能力体系与使用代价', '信息差与知情边界', '掌握路径与敌人反制方式', '七、体系升级空间', '八、中后期防重复机制'];
  const document = headings.map((heading, index) => `## ${heading}\n\n已填写第 ${index + 1} 项设计。`).join('\n\n');
  assert.deepEqual(checkWorldFields(document, 'world.md'), []);
  assert.deepEqual(checkWorldFields(labels.map(label => `- ${label}：有效设计`).join('\n'), 'world.md'), []);
  assert.equal(checkWorldFields(labels.join('，'), 'world.md').length, 8);
  assert.ok(checkWorldFields(document.replace('已填写第 1 项设计。', 'TODO'), 'world.md').some(i => i.code === 'empty_field'));
  assert.ok(checkWorldFields(document.replace('已填写第 1 项设计。', '### 规则一\nTODO\n\n| 规则 | 代价 |\n| --- | --- |'), 'world.md').some(i => i.code === 'empty_field'));
  assert.equal(checkWorldFields('```md\n' + document + '\n```', 'world.md').length, 8);
  assert.ok(checkWorldFields(document.replace('一、世界底层规则', '尚未解释世界底层规则'), 'world.md').some(i => i.code === 'missing_field'));
  assert.deepEqual(checkFields('## 普通必需字段\n内容', ['普通必需字段'], 'x').map(i => i.code), ['missing_field']);
});

test('S03 首次生成前即提供与校验器一致的字段，现实题材无需增设金手指', () => {
  const project = newProject('社区维修铺', 'unused', { genre: '都市日常', constraints: '没有超自然能力' });
  const prompt = systemPrompt(skill, project, 'S03');
  const initial = initialFiles(project, skill, '维修铺经营')[paths.world];
  for (const label of worldRequiredFields) {
    assert.ok(prompt.includes(label));
    assert.ok(initial.includes(`## ${label}`));
  }
  assert.match(prompt, /无金手指的题材/);
  assert.match(prompt, /不能为填字段增设题材之外的设定/);
  assert.equal(checkWorldFields(initial, paths.world).filter(issue => issue.code === 'empty_field').length, worldRequiredFields.length);
  assert.deepEqual(checkWorldFields(initial.replaceAll('待填写', '不适用超自然机制；以真实维修手艺、时间和费用约束推进。'), paths.world), []);
});
test('人物档案的来源说明不误作角色，未评估关系保留表格且仍拒绝非法数据', () => {
  const p = newProject('社区维修铺', 'unused', {});
  const labels = [...fs.readFileSync(path.join(skill, 'references/memory-system.md'), 'utf8').split('```markdown')[1].split('```')[0].matchAll(/^- ([^：:]+)[：:]/gm)].map(m => m[1]);
  const role = `## 陈舟\n\n${labels.map(label => `- ${label}：具体人物设计`).join('\n')}\n`;
  const check = (file: string, content: string) => validateCandidate('S04', p, [{ path: file, content, baseHash: null }], skill, 'revision');
  assert.deepEqual(check(paths.roles, '# 角色卡\n\n## 适用范围与记录口径\n背景与计划分开。\n\n## 依据与版本索引\n设定拆解 v1。\n\n' + role + '\n## 协作入口与防止扩编\n不虚构新人物或已同意的帮助。'), []);
  assert.ok(check(paths.roles, role.replace('- 当前目标：具体人物设计\n', '')).some(i => i.code === 'missing_field'));
  assert.ok(check(paths.roles, role + '\n## 摊主\n尚待补全。').some(i => i.code === 'missing_field'));
  assert.ok(check(paths.roles, '# 角色卡\n## 适用范围\n只有说明，没有角色。').some(i => i.code === 'character_fields'));
  assert.ok(check(paths.roles, '## 来源\n- 当前身份：维修者').some(i => i.code === 'missing_field'));
  const relation = (value: string) => `# 人物关系\n\n| 角色A | 角色B | 关系标签 | 极性 | 信任度0-100 | 冲突点 | 当前状态 | 未来变化方向 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n| 陈舟 | 摊主 | 委托 | ambiguous | ${value} | 营业与等待 | 尚未接洽 | 按计划合作 |\n`;
  for (const value of ['0', '50', '100', '未评估', '未知', 'null', 'null（未评估）', 'null(未评估)']) assert.deepEqual(check(paths.relations, relation(value)), [], value);
  for (const value of ['-1', '101', '50.5', '很信任', 'null（100分）']) assert.ok(check(paths.relations, relation(value)).some(i => i.code === 'relation_trust'), value);
  assert.ok(check(paths.relations, relation('')).some(i => i.code === 'ledger_cells'));
  assert.match(systemPrompt(skill, p, 'S04'), /不要用 0 代替未知/);
});

test('分卷容量接受章节与字数单位，仍检查断档、重叠、总量和非法数值', () => {
  const p = newProject('三万字', 'unused', { targetWords: 30000, chapterWords: 2500 });
  const check = (rows: string) => validateCandidate('S05', p, [{ path: paths.volumes, content: '# 分卷大纲\n' + rows, baseHash: null }], skill, 'revision').filter(i => i.code.startsWith('volume_'));
  for (const row of [
    '| 1 | 开铺 | 1-12 | 12 | 30000 | 001-003 |',
    '| 第1卷 | 开铺 | 第001—012章 | 12章 | 30000字 | 001-003 |',
    '| 第一卷 | 开铺 | 第001章至第012章 | 12 章 | 30000 字 | 001-003 |'
  ]) assert.deepEqual(check(row), []);
  assert.ok(check('| 1 | 开铺 | 2-12 | 11 | 27500 | 001-003 |').some(i => i.code === 'volume_capacity'));
  assert.ok(check('| 1 | 开铺 | 1-12 | 12章 | 30001字 | 001-003 |').some(i => i.code === 'volume_capacity'));
  assert.ok(check('| 1 | 开铺 | 1-11 | 11 | 27500 | 001-003 |').some(i => i.code === 'volume_total'));
  assert.ok(check('| 1 | 开铺 | 1-6 | 6 | 15000 | 001-003 |\n| 2 | 续租 | 6-12 | 7 | 17500 | 006-012 |').some(i => i.code === 'volume_capacity'));
  assert.ok(check('| 1 | 开铺 | 1-12 | 12 | 30000.5字 | 001-003 |').some(i => i.code === 'volume_ranges'));
});

test('章节总纲校验限定主表，附表提及章节不被误判为缺列或重复覆盖', () => {
  const p = newProject('当前三章', 'unused', { targetWords: 30000, batchSize: 3 });
  const header = '| 章节 | 类型 | 强度 | 承接上章 | 前300字入口 | 核心场面 | 主角动作 | 外部推动 | 状态变化 | 设定揭示 | 阅读回报 | 人物记忆变化 | 章末牵引 |';
  const row = (n: number) => `| 第00${n}章 | 推进 | 3 | ${Array(10).fill('具体安排').join(' | ')} |`;
  const main = [header, '|' + Array(13).fill(' --- ').join('|') + '|', row(1), row(2), row(3)].join('\n');
  const check = (content: string) => validateCandidate('S06', p, [{ path: paths.outline, content, baseHash: null }], skill);
  assert.deepEqual(check(main + '\n\n## 成本追踪\n\n| 事项 | 影响 |\n| --- | --- |\n| 第001章陈舟自付租金 | 钱少了 |\n| 第001章 | 留下等待成本 |'), []);
  assert.deepEqual(check(main.replace(row(1), '\n' + row(1)) + '\n\n| 事项 | 影响 |\n| --- | --- |\n| 第001章 | 附表说明 |'), []);
  assert.ok(check(main.replace(row(2), '')).some(i => i.code === 'chapter_coverage'));
  assert.ok(check(main + '\n' + row(2)).some(i => i.code === 'chapter_coverage'));
  assert.ok(check(main.replace(row(2), '| 第002章 | 推进 | 3 | 少字段 |')).some(i => i.code === 'outline_fields'));
  assert.ok(check(main.replace('推进 | 3', '推进 | 9')).some(i => i.code === 'outline_intensity'));
  assert.ok(check(main.replace('推进 | 3', '错误类型 | 3')).some(i => i.code === 'chapter_type'));
  assert.match(systemPrompt(skill, p, 'S06'), /强冲突、推进、结算、日常、情绪、转场/);
});

test('节奏覆盖允许带标题的单元和完整逐章拆分，不放过缺章和重叠', () => {
  const p = newProject('三章脉冲', 'unused', { targetWords: 30000, batchSize: 3 });
  const header = '| 章节单元 | 类型与强度曲线 |\n| --- | --- |\n';
  const check = (rows: string) => validateCandidate('S07', p, [{ path: rhythmPath(activeBatch(p)), content: '# 节奏\n' + header + rows, baseHash: null }], skill).filter(i => i.code === 'rhythm_coverage');
  assert.deepEqual(check('| 第001—003章：完整脉冲 | 4→2→3 |'), []);
  const chapters = '| 第001章：蓄力 | 4 |\n| 第002章：变化 | 2 |\n| 第003章：兑现 | 3 |';
  assert.deepEqual(check('| 第001—003章：完整脉冲 | 4→2→3 |\n' + chapters), []);
  assert.deepEqual(check(chapters + '\n\n| 章节 | 成本 |\n| --- | --- |\n| 第001章 | 租金 |'), []);
  assert.ok(check(chapters.replace('| 第002章：变化 | 2 |\n', '')).length);
  assert.ok(check(chapters + '\n| 第002章：重复 | 2 |').length);
  assert.ok(check('| 第001—002章 | 4→2 |\n| 第002—003章 | 2→3 |').length);
});

test('完整备份、数据库和对象校验恢复到新目录', async () => {
  const { s, p, root } = setup();
  const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-backups-'));
  try {
    const target = await createBackup(s, backupRoot),
      restored = restoreBackup(target, backupRoot);
    assert.notEqual(restored, root);
    const copy = new FileStore(restored);
    try {
      assert.equal(copy.db.project().id, p.id);
      assert.equal(copy.read(paths.config).hash, s.read(paths.config).hash);
    } finally {
      copy.close();
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(target, 'wenxu-backup.json'), 'utf8'));
    atomicWrite(path.join(target, manifest.manifest[0].path), '损坏');
    assert.throws(() => restoreBackup(target, backupRoot), /校验失败/);
  } finally {
    s.close();
  }
});
test('DOCX 中文、标题、列表、表格往返与 TXT 导出', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-docx-')),
    file = path.join(root, '稿件.docx');
  const content = '# 中文标题\n\n阿宁与𠮷字。\n\n- 第一项\n\n| 人物 | 状态 |\n| --- | --- |\n| 阿宁 | 骨折 |';
  await exportDocument(content, file);
  const result = importDocument(file);
  assert.match(result.content, /# 中文标题/);
  assert.match(result.content, /𠮷/);
  assert.match(result.content, /\| 阿宁 \| 骨折 \|/);
  assert.throws(() => importDocument(path.join(root, 'missing.docx')));
});
test('阶段请求必须显式发起，候选拒绝不写正式稿，接受幂等', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-service-'));
  let calls = 0;
  let service: Service;
  const profile = {
    ...profileSchema.parse({
      id: 'test',
      name: 'mock',
      protocol: 'chat',
      baseUrl: 'http://127.0.0.1:1/v1',
      model: 'm',
      contextLimit: 1000000,
      stream: false
    }),
    apiKey: 'test-only'
  };
  service = new Service(
    skill,
    () => {},
    async () => {
      calls++;
      if (calls % 2 === 1) {
        const content = templates(skill)['设定拆解'].replace(/：\s*$/gm, '：有具体内容');
        const call = {
          id: `c${calls}`,
          name: 'propose_changes',
          arguments: JSON.stringify({
            changes: [{ path: paths.seed, baseHash: service.store!.read(paths.seed).hash, content }]
          })
        };
        return {
          text: '候选',
          calls: [call],
          native: { role: 'assistant', tool_calls: [] },
          usage: { input: 10, output: 10, cost: 0, currency: 'USD' },
          stop: 'tools'
        };
      }
      return {
        text: '请审阅',
        calls: [],
        native: { role: 'assistant', content: '请审阅' },
        usage: { input: 10, output: 10, cost: 0, currency: 'USD' },
        stop: 'complete'
      };
    }
  );
  service.profiles = [profile];
  try {
    await service.invoke('project.create', { parent, title: '流程测试', premise: '起点' });
    assert.equal(calls, 0);
    const original = service.store!.read(paths.seed).hash;
    const rid = await service.invoke('run.start', { request: '拆解', profileId: 'test' });
    while (service.runner!.controller) await new Promise((r) => setTimeout(r, 10));
    assert.equal(service.store!.read(paths.seed).hash, original);
    assert.equal(service.store!.db.run(rid).status, 'awaiting_review');
    const style = service.store!.read(paths.style).content;
    fs.appendFileSync(path.join(service.store!.root, paths.style), '\n作者外部修订\n');
    await assert.rejects(
      service.invoke('run.accept', {
        id: rid,
        proposalHash: service.store!.db.run(rid).proposalHash,
        startNext: false
      }),
      /外部修改/
    );
    fs.writeFileSync(path.join(service.store!.root, paths.style), style);
    await service.invoke('run.accept', {
      id: rid,
      proposalHash: service.store!.db.run(rid).proposalHash,
      startNext: false
    });
    assert.equal(service.store!.db.project().stage, 'S02');
    assert.equal(calls, 2);
    const revision = service.store!.db.project().revision;
    await service.invoke('run.accept', { id: rid, startNext: true });
    assert.equal(service.store!.db.project().revision, revision);
    assert.equal(calls, 2);
  } finally {
    service.close();
  }
});
test('打开普通目录失败时保留当前作品且不在目标目录创建数据库', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-open-invalid-'));
  const service = new Service(skill, () => {});
  try {
    await service.invoke('project.create', { parent, title: '保留当前作品', premise: '初稿' });
    const original = service.store!.root;
    const unrelated = path.join(parent, '普通文件夹');
    fs.mkdirSync(unrelated);
    await assert.rejects(service.invoke('project.open', { root: unrelated }), /不是.*项目/);
    assert.equal(service.store!.root, original);
    assert.equal(fs.existsSync(path.join(unrelated, '.novelclient')), false);
  } finally {
    service.close();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
test('逐项核对完成后恢复章节完成状态，不影响未核对范围', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-impact-'));
  const service = new Service(skill, () => {});
  try {
    await service.invoke('project.create', { parent, title: '核对闭环', premise: '初稿' });
    const p = service.store!.db.project();
    p.chapters = { '1': 'stale' };
    p.chapterStatesBeforeReview = { '1': 'complete' };
    p.stale = [paths.roles, paths.summary];
    service.store!.db.set('project', p);
    await service.invoke('impact.review', { path: paths.roles, reason: '逐项核对，无需修改' });
    assert.equal(service.store!.db.project().chapters['1'], 'stale');
    await service.invoke('impact.review', { path: paths.summary, reason: '来源已核对' });
    assert.equal(service.store!.db.project().chapters['1'], 'complete');
    assert.equal(service.store!.db.project().stale.length, 0);
  } finally {
    service.close();
  }
});
