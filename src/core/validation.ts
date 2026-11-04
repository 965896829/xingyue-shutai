import fs from 'node:fs';
import { bookProfilePath, parseBookProfile } from './publishing';
import { parseWorldModel, renderWorldModel } from './world-model';
import path from 'node:path';
import {
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
  worldRequiredFields,
  chapterTypes,
  behaviorRequiredFields,
  estimatedChapters
} from './domain';
import type { Change, Issue, ProjectState, StageId } from '../shared/types';
import { checkProse, checkReviewEvidence } from './manuscript-check';
import { computedScore, declaredTotalScore } from './output-normalization';
import { authorStructureIssues } from './skill-output-contract';
export { computedScore, scoreFields } from './output-normalization';

const blank =
  /^(?:待填写[。.]?|待生成[。.]?|待补充[。.]?|TBD|TODO|\/(?:5|10|100)|是\/否(?:\/无变化|\/未到批次边界)?|未启用\/已启用|用户样本\/用户描述\/项目默认|硬悬念\/软牵引|[-—]*)$/i;
export function checkFields(text: string, labels: string[], file: string, allowSections = false): Issue[] {
  const issues: Issue[] = [];
  const fields = parseMarkdownFields(text);
  if (allowSections) {
    const sections = markdownSections(text);
    for (const label of labels)
      for (const section of sections)
        if (section.label.split(/以及|与|及/).map(part => part.trim()).includes(label)) fields.push({ ...section, label });
  }
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

/** World-design documents allow named sections as well as the legacy list fields. */
export function checkWorldFields(text: string, file: string) {
  if (text.startsWith('# 世界模块')) {
    try {
      const model = parseWorldModel(text);
      if (!model) throw new Error('世界模块结构不完整');
      renderWorldModel(model);
      return [];
    } catch (error) { return [{ code: 'world_model', severity: 'error' as const, path: file, message: (error as Error).message }]; }
  }
  return checkFields(text, [...worldRequiredFields], file, true);
}
function markdownSections(text: string) {
  let fence = '';
  const lines = text.split(/\r?\n/).map(line => {
    const marker = line.trim().match(/^(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ''; return ''; }
    return fence ? '' : line;
  });
  const headings = lines.flatMap((line, index) => {
    const match = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*$/);
    return match ? [{ index, level: match[1].length, label: match[2].replace(/\*\*/g, '').replace(/^(?:[一二三四五六七八九十百\d]+[、.．)]\s*|[（(][一二三四五六七八九十百\d]+[）)]\s*)/, '').trim() }] : [];
  });
  return headings.map((heading, index) => {
    const end = headings.slice(index + 1).find(next => next.level <= heading.level)?.index ?? lines.length;
    const body = lines.slice(heading.index + 1, end).filter((line, i, block) => {
      // Subheadings, table headers and separators alone do not fill a section.
      const separator = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
      return !/^\s*#{1,6}\s/.test(line) && !separator.test(line) && !separator.test(block[i + 1] ?? '');
    }).map(line => line.replace(/^\s*\||\|\s*$/g, '').replace(/\s*\|\s*/g, '\n')).join('\n').trim();
    return { label: heading.label, content: body, line: heading.index + 1 };
  });
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
      const heading = line.match(/^(\s*)#{1,6}[\t ]/);
      if (heading && heading[1].replaceAll('\t', '    ').length <= indent) break;
      if (/^\s*(?:`{3,}|~{3,})/.test(line)) break;
      const list = line.match(/^(\s*)(?:[-*+]|\d+[.)])\s/);
      if (list && list[1].replaceAll('\t', '    ').length <= indent) break;
      parts.push(line);
    }
    result.push({ label: m[2].replace(/\*\*/g, '').trim(), content: parts.join('\n').trim(), line: i + 1 });
  }
  return result;
}
function emptyField(content: string) {
  const lines = content.split('\n');
  const separator = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
  const values = lines.flatMap((line, index) => {
    if (/^\s*#{1,6}[\t ]/.test(line) || separator.test(line) || line.includes('|') && separator.test(lines[index + 1] ?? '')) return [];
    const text = line.trim().replace(/^(?:[-*+]|\d+[.)])\s+/, '').replace(/\*\*/g, '').trim();
    return text.startsWith('|') && text.endsWith('|') ? text.split(/(?<!\\)\|/).slice(1, -1).map(cell => cell.trim()) : [text];
  });
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
function chapterCell(value: string): number | null {
  const match = value.match(/^(?:第?(\d{1,8})章(?=[\s：:\-—]|$)|(\d{1,8})$)/);
  return match ? Number(match[1] ?? match[2]) : null;
}
function markdownHeading(line: string) {
  const match = line.match(/^ {0,3}(#{1,6})[\t ]+(.+)$/);
  return match ? { level: match[1].length, title: match[2] } : null;
}
function chapterHeading(line: string) {
  const heading = markdownHeading(line);
  const match = heading?.title.match(/^第?(\d{1,8})章(?=[\s：:\-—]|$)/);
  return match ? { ...heading!, number: Number(match[1]) } : null;
}
export function chapterNumbers(text: string): number[] {
  let fence = '';
  return text.split(/\r?\n/).flatMap(line => {
    const marker = line.trim().match(/^(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ''; return []; }
    if (fence) return [];
    const heading = chapterHeading(line);
    if (heading) return [heading.number];
    const cell = line.match(/^ {0,3}\|\s*([^|]*?)\s*\|/);
    const number = cell ? chapterCell(cell[1]) : null;
    return number === null ? [] : [number];
  });
}
export function validateCoverage(text: string, start: number, end: number, file: string): Issue[] {
  return validateChapterNumbers(chapterNumbers(text), start, end, file);
}
function validateChapterNumbers(numbers: number[], start: number, end: number, file: string): Issue[] {
  const issues: Issue[] = [];
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
function chapterBlocks(text: string) {
  const lines = text.split(/\r?\n/);
  let fence = '';
  const headings = lines.flatMap((line, index) => {
    const marker = line.trim().match(/^(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ''; return []; }
    if (fence) return [];
    const heading = markdownHeading(line);
    return heading ? [{ index, level: heading.level, chapter: chapterHeading(line)?.number ?? null }] : [];
  });
  return headings.flatMap((heading, index) => {
    if (heading.chapter === null) return [];
    const end = headings.slice(index + 1).find(next => next.chapter !== null || next.level <= heading.level)?.index ?? lines.length;
    return [{ number: heading.chapter, index: heading.index, content: lines.slice(heading.index + 1, end).join('\n') }];
  });
}
function tableContent(text: string, leadingColumns: string[]) {
  let found = false, active = false;
  const rows: string[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (!line.trim()) continue;
    const cells = line.trim().split(/(?<!\\)\|/).slice(1, -1).map(value => value.trim());
    if (leadingColumns.every((label, i) => cells[i] === label)) {
      found = active = true;
      continue;
    }
    const nextCells = (lines[index + 1] ?? '').trim().split('|').slice(1, -1).map(value => value.trim());
    if (nextCells.length && nextCells.every(value => /^:?-+:?$/.test(value))) active = false;
    if (!line.trim().startsWith('|')) active = false;
    if (active) rows.push(line.trim());
  }
  // Older imported outlines may use chapter headings instead of a table.
  return found ? rows.join('\n') : text;
}
function volumeWords(value: string): number | null {
  const equivalent = value.trim().match(/^([^（）()]+)\s*[（(]([^（）()]+)[）)]$/u);
  if (equivalent) {
    const primary = volumeWords(equivalent[1]), annotation = volumeWords(equivalent[2]);
    // Alternate units may clarify the same exact amount; a conflicting or
    // approximate annotation must never be silently discarded.
    return primary !== null && primary === annotation ? primary : null;
  }
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?\s*(万)?\s*字?$/);
  if (!match) return null;
  const fraction = match[2] ?? '', scale = match[3] ? 4 : 0;
  // Shift decimal digits exactly: fractional words and unsafe integers are invalid.
  if (fraction.slice(scale).replace(/0/g, '')) return null;
  const words = BigInt(match[1]) * (match[3] ? 10000n : 1n) + BigInt(fraction.slice(0, scale).padEnd(scale, '0') || '0');
  return words <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(words) : null;
}
export function validateCandidate(
  stage: StageId,
  p: ProjectState,
  changes: Change[],
  skillRoot: string,
  mode = 'stage',
  previousContents?: ReadonlyMap<string, string>
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
    if (c.path === bookProfilePath) {
      try { parseBookProfile(c.content); }
      catch (error) { issues.push({ code: 'publishing_profile', severity: 'error', path: c.path, message: (error as Error).message }); }
    }
    if (!c.path.endsWith('.md')) {
      issues.push({ code: 'file_type', severity: 'error', path: c.path, message: '写作产物必须是 Markdown' });
      continue;
    }
    if (mode === 'stage') issues.push(...authorStructureIssues(c, previousContents?.get(c.path)));
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
    if (key && fields[key] && !(c.path === paths.world && c.content.startsWith('# 世界模块'))) {
      let labels = [...new Set(fields[key])];
      if (c.path === detailPath(p.chapter)) labels = labels.slice(0, labels.indexOf('地点')); // Scene shapes vary with chapter type; enforce the common contract separately.
      if (c.path === paths.style && /状态[：:]\s*未启用/.test(c.content)) labels = [];
      issues.push(...checkFields(c.content, labels, c.path));
    }
    if (c.path === paths.world)
      issues.push(...checkWorldFields(c.content, c.path));
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
      else if (declaredTotalScore(c.content) !== score)
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
          /^\|\s*(?:第)?[一二三四五六七八九十\d]+卷?\s*\|[^|]*\|\s*(?:第)?(\d+)\s*章?\s*[-—～~至]\s*(?:第)?(\d+)\s*章?\s*\|\s*(\d+)\s*章?\s*\|([^|]*)\|/gm
        )
      ].map((m) => ({ start: Number(m[1]), end: Number(m[2]), count: Number(m[3]), words: volumeWords(m[4]) }));
      if (!ranges.length || ranges.some(range => range.words === null))
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
      const table = tableContent(c.content, ['章节单元', '类型与强度曲线']);
      const ranges = [...table.matchAll(/^\|\s*第?(\d+)\s*(?:章\s*)?(?:[-—～~至]\s*第?(\d+)\s*)?章?(?:[：:][^|]*)?\s*\|/gm)]
        .map(m => ({ start: Number(m[1]), end: Number(m[2] ?? m[1]) }))
        .filter(range => range.end >= range.start && range.end - range.start <= 10000);
      for (const range of ranges) {
        const children = ranges.filter(other => other.start >= range.start && other.end <= range.end && (other.start !== range.start || other.end !== range.end));
        // A pulse overview may accompany its complete chapter-by-chapter breakdown.
        // Count the narrower rows once; equal or partial overlaps remain errors.
        const expanded = Array.from({ length: range.end - range.start + 1 }, (_, i) => range.start + i);
        if (children.length && expanded.every(n => children.some(child => child.start <= n && n <= child.end))) continue;
        covered.push(...expanded);
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
      const blocks = c.content.split(/(?=^## )/m).filter((block) => {
        const heading = block.match(/^## (.+)/)?.[1].trim();
        if (!heading) return false;
        const hasRoleFields = parseMarkdownFields(block).some(field => labels.includes(field.label) || field.label === '稳定ID');
        const metadata = /^(?:可追溯.*|适用范围(?:与记录口径)?|记录口径|使用说明|依据与版本索引|来源(?:与版本)?|版本索引|参考资料|协作入口(?:与防止扩编)?)$/u.test(heading);
        return hasRoleFields || !metadata;
      });
      if (!blocks.length)
        issues.push({
          code: 'character_fields',
          severity: 'error',
          path: c.path,
          message: '角色卡需要逐角色二级标题与完整 19 个字段'
        });
      for (const block of blocks) {
        const heading = block.match(/^## (.+)/)?.[1].trim();
        issues.push(...checkFields(block, labels, c.path).map(issue => ({ ...issue, message: `人物分节“${heading}”：${issue.message}` })));
      }
    }
    if (c.path === paths.behavior && stage === 'S11') {
      const section = c.content
        .split(/(?=^## )/m)
        .find((v) => new RegExp(`^## 第0*${p.chapter}章(?:\\s|[：:]|$)`).test(v));
      if (!section)
        issues.push({
          code: 'behavior_chapter',
          severity: 'error',
          path: c.path,
          message: '行为日志缺少本章分节'
        });
      else
        for (const block of section.split(/(?=^### )/m).filter((v) => v.startsWith('### '))) {
          const hasBehaviorFields = parseMarkdownFields(block).some(field => (behaviorRequiredFields as readonly string[]).includes(field.label));
          const unchanged = !hasBehaviorFields &&
            /本章未出场|未新增(?:本人)?(?:行动|行为)|(?:本章|状态)(?:未变化|无变化|未发生变化)/u.test(block) &&
            /保留(?:原|既有)[^\n。]*(?:字段|状态|设定)|不(?:假|强制)?更新|无需更新/u.test(block);
          if (!unchanged) issues.push(...checkFields(block, [...behaviorRequiredFields], c.path));
        }
    }
    if (c.path === paths.summary && stage === 'S11' && p.chapter === b.end)
      issues.push(...checkFields(c.content, fields['批次人物摘要'] ?? [], c.path));
    if (c.path === paths.config) {
      try {
        const cfg = parseConfig(c.content, p.config);
        if (
          cfg.chapterWords !== p.config.chapterWords ||
          cfg.minWords !== p.config.minWords ||
          cfg.maxWords !== p.config.maxWords ||
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
      const blocks = chapterBlocks(c.content);
      issues.push(
        ...checkFields(
          c.content.split(/\r?\n/).slice(0, blocks[0]?.index).join('\n'),
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
      issues.push(...validateChapterNumbers(blocks.map(block => block.number), b.start, b.end, c.path));
      for (const block of blocks)
        issues.push(
          ...checkFields(
            block.content,
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
          ).map(issue => ({ ...issue, message: `第 ${block.number} 章：${issue.message}`, line: issue.line ? block.index + 1 + issue.line : block.index + 1 }))
        );
    }
    if (c.path === paths.outline) {
      const outline = tableContent(c.content, ['章节', '类型', '强度']);
      issues.push(...validateCoverage(outline, b.start, b.end, c.path));
      for (const line of outline.split('\n')) {
        const cells = line
          .split(/(?<!\\)\|/)
          .slice(1, -1)
          .map((v) => v.trim());
        if (chapterCell(cells[0] ?? '') !== null) {
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
          if (!chapterTypes.some(type => cells[1]?.includes(type)))
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
      if (!chapterTypes.some(type => m[1].includes(type)))
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
            message: `关系极性无效：${cells[3]}。允许 positive、neutral、negative、ambiguous；没有已知关系时只保留表头。`
          });
        const unassessed = /^(?:null(?:（未评估）|\(未评估\))?|未知|未评估)$/i.test(cells[4] ?? '');
        if (cells[4] && cells[4] !== '信任度0-100' && !unassessed && (!/^\d+$/.test(cells[4]) || Number(cells[4]) > 100))
          issues.push({
            code: 'relation_trust',
            severity: 'error',
            path: c.path,
            message: `关系信任度须为 0—100 整数；无评分依据填“未评估”，不能以 0 代替未知：${cells[4]}`
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
              message: `伏笔状态无效：${cells[6]}。允许已埋、推进中、已回收、已废弃；没有明确伏笔时只保留表头。`
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
