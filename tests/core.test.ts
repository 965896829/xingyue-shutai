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
  batchPath
} from '../src/core/domain';
import { profileSchema, factSchema, type SecretProfile, type ModelResult } from '../src/shared/types';
import { templates, initialFiles } from '../src/core/skill';
import { validateCandidate, checkFields, validateCoverage } from '../src/core/validation';
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
const skill = path.resolve('resources/skill');
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
    await assert.rejects(service.invoke('run.accept', { id: rid, startNext: false }), /外部修改/);
    fs.writeFileSync(path.join(service.store!.root, paths.style), style);
    await service.invoke('run.accept', { id: rid, startNext: false });
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
