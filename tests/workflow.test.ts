import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Service } from '../src/core/service';
import { templates } from '../src/core/skill';
import { profileSchema, type ProjectState, type ModelResult } from '../src/shared/types';
import {
  paths,
  stageOutputs,
  activeBatch,
  batchPath,
  rhythmPath,
  taskPath,
  detailPath,
  prosePath,
  updatePath,
  qualityPath,
  renderConfig,
  countWords,
  archivePath
} from '../src/core/domain';
import { importLegacy, previewLegacy } from '../src/core/migration';
import { FileStore } from '../src/core/storage';
const root = path.resolve('resources/skill');
const filled = (text: string) =>
  text
    .replace(/：\s*$/gm, '：具体事件与原因')
    .replaceAll('：/5', '：3/5')
    .replaceAll('：/100', '：80/100')
    .replaceAll('：/10', '：8/10')
    .replace(/(- 章节类型：).*/g, '$1推进')
    .replace(/(- 情节强度：).*/g, '$13/5')
    .replace(/：是\/否(?:\/无变化|\/未到批次边界)?/g, '：是')
    .replaceAll('：硬悬念/软牵引', '：软牵引');
function fixture(p: ProjectState, file: string, service: Service) {
  const t = templates(root),
    b = activeBatch(p);
  if (file === paths.seed) return filled(t['设定拆解']);
  if (file === paths.config) return renderConfig(p) + '\n' + filled(t['项目配置']);
  if (file === paths.style) return '# 文风样本与规则\n\n- 状态：未启用\n- 文风来源：项目默认\n';
  if (file === paths.world)
    return (
      '# 世界规则\n\n' +
      [
        '世界底层规则',
        '主角金手指',
        '金手指限制',
        '使用代价',
        '信息差',
        '敌人反制方式',
        '体系升级空间',
        '中后期防重复机制'
      ]
        .map((f) => `- ${f}：具体的限制与代价`)
        .join('\n')
    );
  if (file === paths.roles) {
    const text = fs
      .readFileSync(path.join(root, 'references/memory-system.md'), 'utf8')
      .split('```markdown')[1]
      .split('```')[0];
    return '# 角色卡\n' + filled(text.replace('角色名', '阿宁'));
  }
  if (file === paths.relations)
    return '# 人物关系\n\n| 角色A | 角色B | 关系标签 | 极性 | 信任度0-100 | 冲突点 | 当前状态 | 未来变化方向 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n';
  if (file === paths.volumes)
    return (
      filled(t['分卷大纲']) +
      `\n| 1 | 第一卷 | 1—${Math.ceil(p.config.targetWords / p.config.chapterWords)} | ${Math.ceil(p.config.targetWords / p.config.chapterWords)} | ${p.config.targetWords} | 第1批 | 建立卖点 |\n`
    );
  if (file === paths.outline)
    return (
      t['章节总纲'] +
      '\n' +
      Array.from(
        { length: b.end - b.start + 1 },
        (_, i) =>
          `| 第${b.start + i}章 | 推进 | 3 | 承接前章 | 发现伤势 | 检查伤势 | 求医 | 路程期限 | 决定求医 | 代价 | 信息 | 警惕 | 去药铺 |`
      ).join('\n')
    );
  if (file === rhythmPath(b))
    return (
      t['第001-030章节奏'] +
      `\n| 第${b.start}—${b.end}章 | 推进3→结算2 | 求医 | 赶路 | 伤势 | 药方 | 休养 | 代价 | 约定 |\n`
    );
  if (file === batchPath(b))
    return (
      '# 批量细纲\n\n' +
      [
        '批次范围',
        '依据文件',
        '当前卷',
        '批次主目标',
        '批次结束钩子',
        '本批设定揭示总量',
        '本批禁止提前揭示',
        '本批强度曲线',
        '本批重复结构检查',
        '对应章节总纲范围已扩展',
        '对应三十章节奏文件'
      ]
        .map(
          (f) => `- ${f}：${f === '对应章节总纲范围已扩展' ? '是' : '两章求医与代价，依据已接受总纲和节奏'}`
        )
        .join('\n') +
      '\n\n' +
      Array.from(
        { length: b.end - b.start + 1 },
        (_, i) =>
          `## 第${b.start + i}章：求医\n\n` +
          [
            '承接',
            '章节类型',
            '情节强度',
            '前300字叙事入口',
            '核心场面',
            '主角动作',
            '外部推动',
            '状态变化',
            '设定揭示预算',
            '主要阅读回报',
            '人物记忆变化',
            '章末牵引'
          ]
            .map(
              (f) => `- ${f}：${f === '章节类型' ? '推进' : f === '情节强度' ? '3/5' : '求医事件与明确后果'}`
            )
            .join('\n')
      ).join('\n\n')
    );
  if (file === taskPath(p.chapter)) return filled(t['第XXX章任务清单']);
  if (file === detailPath(p.chapter)) return filled(t['第XXX章细纲']);
  if (file === prosePath(p.chapter)) return '# 本章正文\n\n' + '宁'.repeat(p.config.chapterWords);
  if (file === qualityPath(p.chapter))
    return filled(t['章节质量评分'])
      .replace(/信息落地：.*/, '信息落地：是')
      .replace(/AI句式扫描：.*/, 'AI句式扫描：通过')
      .replace(/字数合规：.*/, '字数合规：是')
      .replace(/是否需要重写：.*/, '是否需要重写：否');
  if (file === updatePath(p.chapter))
    return filled(t['第XXX章记忆更新']).replace(
      /正文实际字数：.*/,
      `正文实际字数：${countWords(service.store!.read(prosePath(p.chapter)).content)}`
    );
  if (file === paths.behavior)
    return (
      '# 情绪与行为记忆\n\n## 第' +
      p.chapter +
      '章\n\n### 阿宁\n\n' +
      [
        '本章情绪',
        '情绪变化原因',
        '本章行动',
        '行动方式是否符合做事风格',
        '对主角态度变化',
        '新增压力',
        '新增秘密或误会',
        '下次出场必须承接'
      ]
        .map((f) => `- ${f}：正文对应内容`)
        .join('\n')
    );
  if (file === paths.summary) return filled(t['批次人物摘要']);
  const existing = service.store!.read(file).content;
  return existing.includes('待填写') ? '# 连续性台账\n\n暂无已确认事件，不伪造记录。' : existing;
}
test('S01—S11 全流程、逐章批准、批次归档与正文待同步状态', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-full-'));
  let service: Service;
  service = new Service(
    root,
    () => {},
    async (_p, _s, messages) => {
      if (messages.at(-1)?.role === 'tool')
        return {
          text: '候选完成',
          calls: [],
          native: { role: 'assistant', content: '候选完成' },
          usage: { input: 1, output: 1, cost: 0, currency: 'USD' },
          stop: 'complete'
        };
      const p = service.store!.db.project(),
        changes = stageOutputs(p.stage, p).map((file) => ({
          path: file,
          baseHash: service.store!.db.document(file)?.hash ?? null,
          content: fixture(p, file, service)
        }));
      return {
        text: '生成候选',
        calls: [
          { id: `${p.stage}-${p.chapter}`, name: 'propose_changes', arguments: JSON.stringify({ changes }) }
        ],
        native: { role: 'assistant', content: '生成候选' },
        usage: { input: 1, output: 1, cost: 0, currency: 'USD' },
        stop: 'tools'
      };
    }
  );
  service.profiles = [
    {
      ...profileSchema.parse({
        id: 'mock',
        name: 'fixture',
        protocol: 'chat',
        model: 'm',
        baseUrl: 'http://127.0.0.1:1/v1',
        stream: false,
        contextLimit: 1000000
      }),
      apiKey: 'fixture'
    }
  ];
  try {
    await service.invoke('project.create', {
      parent,
      title: '全流程',
      premise: '一位伤员求医',
      config: { targetWords: 400, chapterWords: 200, minWords: 200, maxWords: 200, batchSize: 2 }
    });
    assert.equal(service.store!.scan().length, 25);
    let stages = 0;
    while (!service.store!.db.project().finished) {
      const p = service.store!.db.project(),
        id = await service.invoke('run.start', { request: `执行 ${p.stage}`, profileId: 'mock' });
      while (service.runner!.controller) await new Promise((r) => setTimeout(r, 10));
      const r = service.store!.db.run(id);
      assert.equal(r.status, 'awaiting_review', `${r.stage}: ${JSON.stringify(r.issues)} ${r.error}`);
      await service.invoke('run.accept', {
        id,
        startNext: false,
        warningReason: '测试夹具：仅验证结构与状态，不代表文学质量'
      });
      stages++;
      if (p.stage === 'S10') {
        assert.equal(service.store!.db.project().chapters[p.chapter], 'prose_accepted_pending_aftermath');
        assert.equal(service.store!.db.project().stage, 'S11');
      }
      if (stages > 20) throw new Error('流程没有结束');
    }
    assert.equal(stages, 14);
    assert.equal(service.store!.db.project().chapters[2], 'complete');
    assert.ok(
      service.store!.read(archivePath(activeBatch(service.store!.db.project()))).content.includes('第2章')
    );
    assert.match(service.store!.read(paths.summary).content, /摘要覆盖回执/);
  } finally {
    service.close();
  }
});
test('旧档案复制保持原始 UTF-8 BOM、CRLF、备注和九列表格字节', () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-legacy-')),
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-import-'));
  fs.mkdirSync(path.join(source, '04_人物记忆库'));
  const raw = Buffer.from('\uFEFF# 角色卡\r\n\r\n<!-- 自由备注 -->\r\n|甲|乙|丙|丁|戊|己|庚|辛|壬|\r\n');
  fs.writeFileSync(path.join(source, paths.roles), raw);
  const preview = previewLegacy(source);
  assert.equal(preview.files.length, 1);
  const target = importLegacy({ source, parent, title: '旧稿', chapter: 1, stage: 'S01', config: {} });
  assert.deepEqual(fs.readFileSync(path.join(target, paths.roles)), raw);
  assert.deepEqual(fs.readFileSync(path.join(source, paths.roles)), raw);
  const s = new FileStore(target);
  try {
    assert.ok(s.db.project().stale.includes(paths.roles));
  } finally {
    s.close();
  }
});
