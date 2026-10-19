import fs from 'node:fs';
import path from 'node:path';
import type { Service } from '../../src/core/service';
import { templates } from '../../src/core/skill';
import type { ProjectState } from '../../src/shared/types';
import {
  paths,
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
  hash
} from '../../src/core/domain';
import { reviewAspects } from '../../src/core/manuscript-check';
const root = path.resolve('resources/skill');
export function sampleProse(words = 2500) {
  const paragraphs = [
    '阿宁推开诊室的门，把记录本递到灯下。医生没有接，先指了指他袖口的血。他才发觉右手一直在抖，走廊里的脚步声已经到了门外。',
    '窗边那人合上报纸，问他从哪条路过来。阿宁说是旧桥，话出口却看见桌角那双湿鞋。桥已经封了三天，鞋底还嵌着桥上才有的红砂。',
    '医生把药箱放到门口，压低声音让他们从后院走。阿宁拦住他，从记录本里抽出那张收据。收据上的时间，比诊所开门早了整整一小时。',
    '门外的钥匙转了半圈，忽然停住。有人隔着门叫医生的名字。阿宁退到窗下，把收据折好塞进口袋，左手握住了门边的木凳。',
    '后院传来水桶落地的声音。医生脸色变了，伸手去拿柜顶的手电。阿宁先拉灭了灯，贴着墙听清第二串脚步，才示意他把门闩抬起。'
  ];
  let body = '', index = 0;
  while (Array.from(body).length < words) {
    body += `${paragraphs[index % paragraphs.length]}墙上的钟又走过${++index}格。`;
  }
  return '# 本章正文\n\n' + Array.from(body).slice(0, words).join('');
}
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
export function fixture(p: ProjectState, file: string, service: Service) {
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
  if (file === prosePath(p.chapter)) return sampleProse(p.config.chapterWords);
  if (file === qualityPath(p.chapter)) {
    const prose = service.store!.db.runs().find(run => run.pipeline && run.status === 'running')?.changes.find(change => change.path === prosePath(p.chapter))?.content ?? sampleProse(p.config.chapterWords);
    return filled(t['章节质量评分'])
      .replace(/信息落地：.*/, '信息落地：是')
      .replace(/AI句式扫描：.*/, 'AI句式扫描：通过')
      .replace(/字数合规：.*/, '字数合规：是')
      .replace(/是否需要重写：.*/, '是否需要重写：否') + '\n\n```json wenxu-review\n' + JSON.stringify({
        proseHash: hash(prose),
        checks: reviewAspects.map((aspect, index) => ({ aspect, verdict: 'pass', quote: Array.from(prose).slice(10 + index * 12, 26 + index * 12).join(''), reason: '此处通过具体行动推进求医事件，合成夹具仅用于流程验收。' }))
      }) + '\n```\n';
  }
  if (file === updatePath(p.chapter))
    return filled(t['第XXX章记忆更新']).replace(
      /正文实际字数：.*/,
      `正文实际字数：${countWords(
        service
          .store!.db.runs()
          .find((r) => r.pipeline && r.status === 'running')
          ?.changes.find((c) => c.path === prosePath(p.chapter))?.content ??
          service.store!.read(prosePath(p.chapter)).content
      )}`
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
