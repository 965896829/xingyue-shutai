import fs from 'node:fs';
import path from 'node:path';
import {
  countWords,
  activeBatch,
  batchPath,
  stageOutputs,
  taskPath,
  detailPath,
  paths,
  prosePath,
  parseConfig,
  qualityPath,
  rhythmPath,
  estimatedChapters
} from './domain';
import type { Change, Issue, ProjectState, StageId } from '../shared/types';
import { checkProse, checkReviewEvidence } from './manuscript-check';

const blank =
  /^(?:待填写[。.]?|待生成[。.]?|待补充[。.]?|TBD|TODO|\/(?:5|10|100)|是\/否(?:\/无变化|\/未到批次边界)?|未启用\/已启用|用户样本\/用户描述\/项目默认|硬悬念\/软牵引|[-—]*)$/i;
export const scoreFields = [
  '开头有效性',
  '强度与章节功能匹配',
  '主角主动性',
  '阅读回报',
  '设定使用',
  '状态变化',
  '人物一致性',
  '节奏可读性',
  '留白与非总结化',
  '章末牵引'
];
export function computedScore(content: string): number | null {
  let total = 0;
  for (const label of scoreFields) {
    const m = content.match(new RegExp(`^- ${label}[：:]\\s*(\\d+(?:\\.\\d+)?)\\s*(?:/10)?\\s*$`, 'm'));
    if (!m || Number(m[1]) > 10 || Number(m[1]) < 0) return null;
    total += Number(m[1]);
  }
  return Math.round(total * 10) / 10;
}
export function checkFields(text: string, labels: string[], file: string): Issue[] {
  const issues: Issue[] = [];
  const fields = parseMarkdownFields(text);
  for (const label of labels) {
    const matches = fields.filter((f) => f.label === label);
    if (!matches.length)
      issues.push({ code: 'missing_field', severity: 'error', path: file, message: `缺少字段：${label}` });
    for (const m of matches)
      if (emptyField(m.content))
        issues.push({
          code: 'empty_field',
          severity: 'error',
          path: file,
          message: `字段没有有效内容：${label}`,
          line: m.line
        });
  }
  return issues;
}
/** A field owns continuation paragraphs and deeper lists, never its next sibling or heading. */
export function parseMarkdownFields(text: string): { label: string; content: string; line: number }[] {
  const lines = text.split(/\r?\n/),
    result: { label: string; content: string; line: number }[] = [];
  let fence = '';
  for (let i = 0; i < lines.length; i++) {
    const marker = lines[i].trim().match(/^(`{3,}|~{3,})/);
    if (marker) {
      fence = fence ? '' : marker[1][0];
      continue;
    }
    if (fence) continue;
    const m = lines[i].match(/^(\s*)[-*+]\s+(?:\*\*)?([^：:\r\n]+?)(?:\*\*)?[：:]\s*(.*)$/);
    if (!m) continue;
    const indent = m[1].replaceAll('\t', '    ').length;
    const parts = [m[3].replace(/^\*\*/, '')];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (/^\s*(?:#{1,6}\s|`{3,}|~{3,})/.test(line)) break;
      const list = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s/);
      if (list && list[1].replaceAll('\t', '    ').length <= indent) break;
      parts.push(line);
    }
    result.push({ label: m[2].replace(/\*\*/g, '').trim(), content: parts.join('\n').trim(), line: i + 1 });
  }
  return result;
}
function emptyField(content: string) {
  const values = content.split('\n').map((s) =>
    s
      .trim()
      .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/\*\*/g, '')
      .trim()
  );
  return values.every((s) => blank.test(s));
}
export function templateFields(skillRoot: string): Record<string, string[]> {
  const text = fs.readFileSync(path.join(skillRoot, 'references/templates.md'), 'utf8');
  const result: Record<string, string[]> = {};
  let heading = '';
  let fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith('```')) {
      fenced = !fenced;
      continue;
    }
    if (fenced && /^# /.test(line)) heading = line.slice(2).trim();
    const field = line.match(/^- ([^：:]+)[：:]/);
    if (fenced && field && heading) (result[heading] ??= []).push(field[1]);
  }
  return result;
}
export function chapterNumbers(text: string): number[] {
  return [...text.matchAll(/(?:^|\n)(?:#{1,6}\s*|\|\s*)第?(\d{1,8})章(?=[\s：:|\-—]|$)/g)].map((m) =>
    Number(m[1])
  );
}
export function validateCoverage(text: string, start: number, end: number, file: string): Issue[] {
  const numbers = chapterNumbers(text),
    issues: Issue[] = [];
  for (let n = start; n <= end; n++)
    if (numbers.filter((v) => v === n).length !== 1)
      issues.push({
        code: 'chapter_coverage',
        severity: 'error',
        path: file,
        message: `第 ${n} 章需要唯一、明确的标题或表格行`
      });
  return issues;
}
export function validateCandidate(
  stage: StageId,
  p: ProjectState,
  changes: Change[],
  skillRoot: string,
  mode = 'stage'
): Issue[] {
  const issues: Issue[] = [],
    b = activeBatch(p),
    fields = templateFields(skillRoot);
  const required = stageOutputs(stage, p).filter(
    (f) => stage !== 'S11' || f === `08_章后更新/第${String(p.chapter).padStart(3, '0')}章记忆更新.md`
  );
  if (mode === 'stage')
    for (const file of required)
      if (!changes.some((c) => c.path === file))
        issues.push({
          code: 'missing_output',
          severity: 'error',
          path: file,
          message: '本阶段必需产物尚未生成'
        });
  const fieldMapping: Record<string, string> = {
    [paths.seed]: '设定拆解',
    [paths.config]: '项目配置',
    [paths.style]: '文风样本与规则',
    [paths.volumes]: '分卷大纲',
    [taskPath(p.chapter)]: '第XXX章任务清单',
    [detailPath(p.chapter)]: '第XXX章细纲',
    [`08_章后更新/第${String(p.chapter).padStart(3, '0')}章记忆更新.md`]: '第XXX章记忆更新'
  };
  const tableContracts: Record<string, string[][]> = {
    [paths.relations]: [
      ['角色A', '角色B', '关系标签', '极性', '信任度0-100', '冲突点', '当前状态', '未来变化方向']
    ],
    [paths.timeline]: [['时间锚点', '章节', '地点', '已发生事件', '后续期限或影响']],
    [paths.hooks]: [['编号', '首次出现', '表面线索', '当前证据', '谁知道', '计划回收', '状态']],
    [paths.items]: [
      ['名称', '持有人或位置', '当前状态', '来源章节', '连续性限制'],
      ['角色', '伤势', '严重度', '当前限制', '治疗与恢复依据', '最近更新']
    ],
    [paths.terms]: [['术语', '白话定义', '触发条件', '直接后果', '代价或限制', '首次说明', '仍未知']],
    [paths.knowledge]: [['角色', '亲眼确认', '被告知', '当前推测或误解', '不知道的关键事实', '最近更新']]
  };
  for (const c of changes) {
    if (!c.path.endsWith('.md')) {
      issues.push({ code: 'file_type', severity: 'error', path: c.path, message: '写作产物必须是 Markdown' });
      continue;
    }
    const lines = c.content.split(/\r?\n/);
    for (const header of tableContracts[c.path] ?? []) {
      const cells = (line: string) =>
        line
          .trim()
          .split(/(?<!\\)\|/)
          .slice(1, -1)
          .map((v) => v.trim());
      const start = lines.findIndex((line) => JSON.stringify(cells(line)) === JSON.stringify(header));
      if (start < 0) {
        issues.push({
          code: 'ledger_header',
          severity: 'error',
          path: c.path,
          message: `缺少原台账字段：${header.join('、')}`
        });
        continue;
      }
      for (let i = start + 1; i < lines.length && lines[i].trim().startsWith('|'); i++) {
        const row = cells(lines[i]);
        if (row.every((v) => /^:?-+:?$/.test(v))) continue;
        if (row.length !== header.length || row.some((v) => blank.test(v)))
          issues.push({
            code: 'ledger_cells',
            severity: 'error',
            path: c.path,
            line: i + 1,
            message: '台账行列数不符或有空字段；无、未知与未发生需要明确填写'
          });
      }
    }
    if (c.content.trim().length < 10 || /^## 内容\s*\n\s*待填写/m.test(c.content))
      issues.push({ code: 'placeholder', severity: 'error', path: c.path, message: '产物仍为空或占位文本' });
    const key = fieldMapping[c.path];
    const known = new Set(Object.values(fields).flat());
    for (const m of parseMarkdownFields(c.content))
      if (known.has(m.label) && emptyField(m.content) && !(key && fields[key]?.includes(m.label)))
        issues.push({
          code: 'template_placeholder',
          severity: 'error',
          path: c.path,
          message: `模板字段 ${m.label} 仍未填写或选择具体状态`,
          line: m.line
        });
    if (key && fields[key]) {
      let labels = [...new Set(fields[key])];
      if (c.path === detailPath(p.chapter)) labels = labels.slice(0, labels.indexOf('地点')); // Scene shapes vary with chapter type; enforce the common contract separately.
      if (c.path === paths.style && /状态[：:]\s*未启用/.test(c.content)) labels = [];
      issues.push(...checkFields(c.content, labels, c.path));
    }
    if (c.path === paths.world)
      issues.push(
        ...checkFields(
          c.content,
          [
            '世界底层规则',
            '主角金手指',
            '金手指限制',
            '使用代价',
            '信息差',
            '敌人反制方式',
            '体系升级空间',
            '中后期防重复机制'
          ],
          c.path
        )
      );
    if (c.path === qualityPath(p.chapter)) {
      const prose = changes.find(change => change.path === prosePath(p.chapter));
      if (prose) issues.push(...checkReviewEvidence(c.path, c.content, prose.content));
      const score = computedScore(c.content);
      if (score === null)
        issues.push({
          code: 'quality_score',
          severity: 'error',
          path: c.path,
          message: '质量评分必须包含十项 0—10 分数'
        });
      else if (!new RegExp(`总分[：:]\\s*${score}(?:\\s*/100)?(?:\\s|$)`).test(c.content))
        issues.push({
          code: 'quality_total',
          severity: 'error',
          path: c.path,
          message: `程序核算总分为 ${score}/100，请更正报告`
        });
      issues.push(
        ...checkFields(c.content, ['信息落地', 'AI句式扫描', '字数合规', '是否需要重写', '修改意见'], c.path)
      );
      if (/是否需要重写[：:]\s*是/.test(c.content))
        issues.push({
          code: 'quality_rewrite',
          severity: 'error',
          path: c.path,
          message: '质量报告要求重写，请先修订候选'
        });
    }
    if (c.path === paths.volumes) {
      const ranges = [
        ...c.content.matchAll(
          /^\|\s*(?:第)?[一二三四五六七八九十\d]+卷?\s*\|[^|]*\|\s*(?:第)?(\d+)\s*[-—～~至]\s*(\d+)章?\s*\|\s*(\d+)\s*\|\s*(\d+)/gm
        )
      ].map((m) => ({ start: Number(m[1]), end: Number(m[2]), count: Number(m[3]), words: Number(m[4]) }));
      if (!ranges.length)
        issues.push({
          code: 'volume_ranges',
          severity: 'error',
          path: c.path,
          message: '容量表需有可解析的卷数、卷名、数字章节范围、预计章数及预计字数'
        });
      let next = 1;
      for (const range of ranges) {
        if (
          range.start !== next ||
          range.end < range.start ||
          range.count !== range.end - range.start + 1 ||
          range.words !== range.count * p.config.chapterWords
        )
          issues.push({
            code: 'volume_capacity',
            severity: 'error',
            path: c.path,
            message: '分卷范围有重叠、断档或容量计算错误'
          });
        next = range.end + 1;
      }
      if (ranges.length && next - 1 !== estimatedChapters(p.config))
        issues.push({
          code: 'volume_total',
          severity: 'error',
          path: c.path,
          message: '分卷范围未覆盖预计全书章数'
        });
    }
    if (c.path === rhythmPath(b)) {
      const covered: number[] = [];
      for (const m of c.content.matchAll(/^\|\s*第?(\d+)\s*(?:[-—～~至]\s*(\d+))?章?\s*\|/gm)) {
        const start = Number(m[1]),
          end = Number(m[2] ?? m[1]);
        if (end - start > 10000) continue;
        for (let n = start; n <= end; n++) covered.push(n);
      }
      for (let n = b.start; n <= b.end; n++)
        if (covered.filter((v) => v === n).length !== 1)
          issues.push({
            code: 'rhythm_coverage',
            severity: 'error',
            path: c.path,
            message: `节奏波段没有唯一覆盖第 ${n} 章`
          });
    }
    if (c.path === paths.roles) {
      const source = fs.readFileSync(path.join(skillRoot, 'references/memory-system.md'), 'utf8');
      const labels = [
        ...source
          .split('```markdown')[1]
          .split('```')[0]
          .matchAll(/^- ([^：:]+)[：:]/gm)
      ].map((m) => m[1]);
      const blocks = c.content.split(/(?=^## )/m).filter((x) => /^## (?!可追溯)/.test(x));
      if (!blocks.length)
        issues.push({
          code: 'character_fields',
          severity: 'error',
          path: c.path,
          message: '角色卡需要逐角色二级标题与完整 19 个字段'
        });
      for (const block of blocks) issues.push(...checkFields(block, labels, c.path));
    }
    if (c.path === paths.behavior && stage === 'S11') {
      const section = c.content
        .split(/(?=^## 第\d+章)/m)
        .find((v) => new RegExp(`^## 第0*${p.chapter}章`).test(v));
      if (!section)
        issues.push({
          code: 'behavior_chapter',
          severity: 'error',
          path: c.path,
          message: '行为日志缺少本章分节'
        });
      else
        for (const block of section.split(/(?=^### )/m).filter((v) => v.startsWith('### ')))
          issues.push(
            ...checkFields(
              block,
              [
                '本章情绪',
                '情绪变化原因',
                '本章行动',
                '行动方式是否符合做事风格',
                '对主角态度变化',
                '新增压力',
                '新增秘密或误会',
                '下次出场必须承接'
              ],
              c.path
            )
          );
    }
    if (c.path === paths.summary && stage === 'S11' && p.chapter === b.end)
      issues.push(...checkFields(c.content, fields['批次人物摘要'] ?? [], c.path));
    if (c.path === paths.config) {
      try {
        const cfg = parseConfig(c.content, p.config);
        if (
          cfg.chapterWords !== p.config.chapterWords ||
          cfg.batchSize !== p.config.batchSize ||
          cfg.targetWords !== p.config.targetWords
        )
          issues.push({
            code: 'config_drift',
            severity: 'error',
            path: c.path,
            message: 'AI 修改了作者设置的容量参数，请先在项目设置中明确修改'
          });
      } catch (e) {
        issues.push({
          code: 'invalid_config',
          severity: 'error',
          path: c.path,
          message: (e as Error).message
        });
      }
    }
    if (c.path === batchPath(b)) {
      issues.push(
        ...checkFields(
          c.content.split(/^## /m)[0],
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
          ],
          c.path
        )
      );
      issues.push(...validateCoverage(c.content, b.start, b.end, c.path));
      const blocks = c.content.split(/(?=^## 第\d+章)/m).filter((x) => /^## 第\d+章/.test(x));
      for (const block of blocks)
        issues.push(
          ...checkFields(
            block,
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
            ],
            c.path
          )
        );
    }
    if (c.path === paths.outline) {
      issues.push(...validateCoverage(c.content, b.start, b.end, c.path));
      for (const line of c.content.split('\n')) {
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((v) => v.trim());
        if (/^第?\d+章/.test(cells[0] ?? '')) {
          if (cells.length !== 13 || cells.some((v) => !v || blank.test(v)))
            issues.push({
              code: 'outline_fields',
              severity: 'error',
              path: c.path,
              message: '章节总纲每章需要完整 13 列'
            });
          if (!/^[1-5](?:\/5)?$/.test(cells[2] ?? ''))
            issues.push({
              code: 'outline_intensity',
              severity: 'error',
              path: c.path,
              message: '总纲强度必须为 1—5'
            });
          if (!/强冲突|推进|结算|日常|情绪|转场/.test(cells[1] ?? ''))
            issues.push({
              code: 'chapter_type',
              severity: 'error',
              path: c.path,
              message: '总纲章节类型无效'
            });
        }
      }
    }
    if (c.path === detailPath(p.chapter) && !/^## 场面\d+/m.test(c.content))
      issues.push({
        code: 'scene_structure',
        severity: 'error',
        path: c.path,
        message: '单章细纲至少需要一个具体场面，场面数量按类型决定'
      });
    for (const m of c.content.matchAll(/^- 章节类型[：:]\s*(.*)$/gm))
      if (!/强冲突|推进|结算|日常|情绪|转场/.test(m[1]))
        issues.push({
          code: 'chapter_type',
          severity: 'error',
          path: c.path,
          message: `不支持的章节类型：${m[1]}`
        });
    if (c.path.startsWith('07_正文章节/')) {
      issues.push(...checkProse(c.path, c.content, p.config));
      const patterns = [
        /不是[^。！？\n]{0,40}而是/gu,
        /并非[^。！？\n]{0,40}只是/gu,
        /与其说[^。！？\n]{0,40}不如说/gu,
        /这意味着|也就是说|所谓[^。！？\n]{0,20}说白了/gu,
        /此言一出|与此同时|下一刻|就在这时/gu
      ];
      for (const re of patterns) {
        const matches = [...c.content.matchAll(re)];
        if (matches.length > 1)
          issues.push({
            code: 'style_pattern',
            severity: 'warning',
            path: c.path,
            message: `句式重复 ${matches.length} 次：${matches
              .slice(0, 3)
              .map((m) => m[0])
              .join('、')}。请结合语境审阅，台词例外可保留。`
          });
      }
    }
    for (const m of c.content.matchAll(/(?:情节强度|强度)[：:]\s*([\d.]+)/g))
      if (!/^[1-5]$/.test(m[1]))
        issues.push({
          code: 'intensity',
          severity: 'error',
          path: c.path,
          message: `情节强度必须是 1—5 整数，发现 ${m[1]}`
        });
    if (c.path === paths.relations) {
      for (const line of c.content.split('\n').filter((l) => l.startsWith('|') && !l.includes('---'))) {
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((x) => x.trim());
        if (
          cells[3] &&
          cells[3] !== '极性' &&
          !['positive', 'neutral', 'negative', 'ambiguous'].includes(cells[3])
        )
          issues.push({
            code: 'relation_polarity',
            severity: 'error',
            path: c.path,
            message: `关系极性无效：${cells[3]}`
          });
        if (cells[4] && cells[4] !== '信任度0-100' && (!/^\d+$/.test(cells[4]) || Number(cells[4]) > 100))
          issues.push({
            code: 'relation_trust',
            severity: 'error',
            path: c.path,
            message: `关系信任度必须为 0—100：${cells[4]}`
          });
      }
    }
    if (c.path === paths.hooks) {
      const seen = new Set<string>();
      for (const line of c.content.split('\n').filter((l) => l.startsWith('|') && !l.includes('---'))) {
        const cells = line
          .split('|')
          .slice(1, -1)
          .map((x) => x.trim());
        if (cells[0] && cells[0] !== '编号') {
          if (seen.has(cells[0]))
            issues.push({
              code: 'hook_duplicate',
              severity: 'error',
              path: c.path,
              message: `伏笔编号重复：${cells[0]}`
            });
          seen.add(cells[0]);
          if (cells[6] && !['已埋', '推进中', '已回收', '已废弃'].includes(cells[6]))
            issues.push({
              code: 'hook_state',
              severity: 'error',
              path: c.path,
              message: `伏笔状态无效：${cells[6]}`
            });
        }
      }
    }
    const fenceCount = c.content.split('\n').filter((l) => l.startsWith('```')).length;
    if (fenceCount % 2)
      issues.push({
        code: 'markdown_fence',
        severity: 'error',
        path: c.path,
        message: 'Markdown 代码块未闭合，可能输出截断'
      });
    if (/[\uFFFD]/.test(c.content))
      issues.push({
        code: 'encoding',
        severity: 'error',
        path: c.path,
        message: '文稿含替换字符，需检查编码'
      });
  }
  if (changes.some((c) => c.path === prosePath(p.chapter)))
    issues.push({
      code: 'semantic_review',
      severity: 'warning',
      message: '请审阅人物选择、信息落地、连续性和阅读回报；结构检查不能证明文学质量。'
    });
  const fieldPositions = new Set<string>();
  return issues.filter((issue) => {
    if (!['empty_field', 'template_placeholder'].includes(issue.code)) return true;
    const key = `${issue.path}:${issue.line}`;
    if (fieldPositions.has(key)) return false;
    fieldPositions.add(key);
    return true;
  });
}
