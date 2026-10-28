import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { activeBatch, batchPath, hash, newProject, paths, prosePath, qualityPath } from '../src/core/domain';
import { reviewAspects } from '../src/core/manuscript-check';
import { computedScore, declaredTotalScore, normalizeCandidate, scoreFields } from '../src/core/output-normalization';
import { chapterNumbers, checkFields, parseMarkdownFields, validateCandidate, validateCoverage } from '../src/core/validation';

const skill = path.resolve('resources/skill');
const project = newProject('格式兼容回归', 'unused', { targetWords: 30000, chapterWords: 2500, batchSize: 3 });
const header = '| 章节 | 类型 | 强度 | 承接上章 | 前300字入口 | 核心场面 | 主角动作 | 外部推动 | 状态变化 | 设定揭示 | 阅读回报 | 人物记忆变化 | 章末牵引 |';
const separator = `| ${Array(13).fill('---').join(' | ')} |`;
const row = (chapter: string) => `| ${chapter} | 推进 | 3 | ${Array(10).fill('具体安排').join(' | ')} |`;
const outline = (chapters: string[]) => ['# 章节总纲', '', header, separator, ...chapters.map(row)].join('\n');
const checkOutline = (content: string) => validateCandidate('S06', project, [{ path: paths.outline, content, baseHash: null }], skill);

test('S01 真实摘录的缩进子标题、表格及段落归属字段，不误报空值', () => {
  const excerpt = `- 世界不公平规则：

  ### 作者已定的核心规则

  | 规则 | 已定内容 | 叙事约束 |
  | --- | --- | --- |
  | 杀人资格 | 只有有效死亡权持有人能够真正杀死对应标的 | 有权是必要资格，不是自动处决按钮 |

- 长线连载动力：

  ### 可重复运行、但不重复答案的故事引擎

  每个阶段从具体的人和权证关系开始：谁持有谁的命，谁想自赎，谁拒绝放手，谁会从一次死亡中继承好处。

- 风险与修正：

  ### 必须在规则设计时集中确认的边界

  1. **抢到纸证是否等于取得死亡权。** 原设定支持交易与夺取，但尚未规定生效瞬间、身份核验、代持和伪证的关系。`;
  assert.deepEqual(checkFields(excerpt, ['世界不公平规则', '长线连载动力', '风险与修正'], paths.seed), []);
  const fields = parseMarkdownFields(excerpt);
  assert.match(fields[0].content, /只有有效死亡权持有人/);
  assert.doesNotMatch(fields[0].content, /每个阶段从具体/);
  assert.match(fields[1].content, /每个阶段从具体/);
  assert.doesNotMatch(fields[1].content, /抢到纸证/);
});

test('结构字段不能靠空子标题、空表或同级兄弟内容填满', () => {
  const check = (content: string) => checkFields(content, ['规则'], 'test').filter(issue => issue.code === 'empty_field');
  for (const shell of [
    '- 规则：\n  ### 子标题\n',
    '- 规则：\n  | 项目 | 说明 |\n  | --- | --- |\n',
    '- 规则：\n  ### 子标题\n  | 项目 | 说明 |\n  | --- | --- |\n  | 待填写 | |\n',
    '- 规则：\n  ### 子标题\n- 下一字段：兄弟字段有实际内容\n',
    '- 规则：\n  ### 子标题\n### 同级标题\n这里有实际内容但不属于字段。\n',
    '  - 规则：\n    ### 子标题\n  ### 同级标题\n有别处内容。\n'
  ]) assert.equal(check(shell).length, 1, shell);
  assert.deepEqual(check('- 规则：\n  ### 子标题\n  | 项目 | 说明 |\n  | --- | --- |\n  | 资格 | 持有人具备资格 |'), []);
  assert.deepEqual(check('  - 规则：\n    ### 子标题\n    实际限制与执行后果。\n  - 下一字段：另一事项'), []);
});

test('章节主表接受纯数字、零填充和带章字的首列，附表不制造重复', () => {
  for (const chapters of [['1', '2', '3'], ['001', '002', '003'], ['第001章：开端', '002章', '3']]) {
    const main = outline(chapters);
    assert.deepEqual(checkOutline(main), [], chapters.join(','));
    assert.deepEqual(checkOutline(main + '\n\n| 序号 | 说明 |\n| --- | --- |\n| 1 | 附表编号 |'), []);
  }
  assert.deepEqual(chapterNumbers('## 第999章 标题\n## 第1000章\n| 1001 | 推进 |'), [999, 1000, 1001]);
});

test('纯数字章号仍检查缺章、重复、13 列、类型与强度', () => {
  const main = outline(['001', '002', '003']);
  assert.ok(checkOutline(outline(['001', '003'])).some(issue => issue.code === 'chapter_coverage'));
  assert.ok(checkOutline(main + '\n' + row('第002章')).some(issue => issue.code === 'chapter_coverage'));
  assert.ok(checkOutline(main.replace(row('002'), '| 002 | 推进 | 3 | 缺列 |')).some(issue => issue.code === 'outline_fields'));
  assert.ok(checkOutline(main.replace('推进 | 3', '推进 | 9')).some(issue => issue.code === 'outline_intensity'));
  assert.ok(checkOutline(main.replace('推进 | 3', '错误类型 | 3')).some(issue => issue.code === 'chapter_type'));
  for (const invalid of ['1.0', '1-2', '第001', '1 说明'])
    assert.ok(checkOutline(outline([invalid, '2', '3'])).some(issue => issue.code === 'chapter_coverage'), invalid);
  assert.equal(validateCoverage('## 1\n正文提到第1章\n| 说明 | 1 |\n```md\n| 1 | 示例 |\n```', 1, 1, 'test').length, 1);
});

const batchFields = ['批次范围', '依据文件', '当前卷', '批次主目标', '批次结束钩子', '本批设定揭示总量', '本批禁止提前揭示', '本批强度曲线', '本批重复结构检查', '对应章节总纲范围已扩展', '对应三十章节奏文件'];
const chapterFields = ['承接', '章节类型', '情节强度', '前300字叙事入口', '核心场面', '主角动作', '外部推动', '状态变化', '设定揭示预算', '主要阅读回报', '人物记忆变化', '章末牵引'];
const chapterBody = chapterFields.map(label => `- ${label}：${label === '章节类型' ? '推进' : label === '情节强度' ? '3/5' : '有具体安排与行动结果'}`).join('\n');
const batchHeader = '# 本批细纲\n' + batchFields.map(label => `- ${label}：${label === '对应章节总纲范围已扩展' ? '是' : '已核对的范围与依据'}`).join('\n');
const batchProject = newProject('三十章字段边界', 'unused', { targetWords: 300000, batchSize: 30 });
const batchFile = batchPath(activeBatch(batchProject));
const checkBatch = (content: string) => validateCandidate('S08', batchProject, [{ path: batchFile, content, baseHash: null }], skill);
const batchChapters = (level: (n: number) => number) => Array.from({ length: 30 }, (_, i) => `\n${'#'.repeat(level(i + 1))} 第${String(i + 1).padStart(3, '0')}章：下一步\n${chapterBody}`).join('\n');

test('S08 统一章节覆盖与字段块，合法一级至六级标题逐章检查十二字段', () => {
  for (const level of [1, 2, 3, 4, 5, 6])
    assert.deepEqual(checkBatch(batchHeader + batchChapters(() => level)), [], `${level}级标题`);
  assert.deepEqual(checkBatch(batchHeader + batchChapters(n => (n - 1) % 6 + 1)), []);
  assert.deepEqual(checkBatch(batchHeader + batchChapters(() => 3).replaceAll('\n### ', '\n   ### ')), []);
});

test('S08 空三级第30章、表格或围栏冒充章节均不能绕过字段检查', () => {
  const chapters = batchChapters(() => 2);
  const last = `\n## 第030章：下一步\n${chapterBody}`;
  const emptyLast = batchHeader + chapters.replace(last, '\n### 第30章：下一步\n');
  const missing = checkBatch(emptyLast).filter(issue => issue.code === 'missing_field' && issue.message.startsWith('第 30 章：'));
  assert.equal(missing.length, 12);
  assert.ok(missing.every(issue => issue.line !== undefined));
  assert.equal(checkBatch(emptyLast + '\n### 其他规划\n' + chapterBody).filter(issue => issue.code === 'missing_field' && issue.message.startsWith('第 30 章：')).length, 12);
  assert.ok(checkBatch(batchHeader + chapters.replace(last, '\n| 30 | 本章说明 |')).some(issue => issue.code === 'chapter_coverage'));
  assert.ok(checkBatch(batchHeader + chapters.replace(last, '\n```md\n### 第30章\n' + chapterBody + '\n```')).some(issue => issue.code === 'chapter_coverage'));
  assert.ok(checkBatch(batchHeader + chapters.replace('## 第030章', '##第030章')).some(issue => issue.code === 'chapter_coverage'));
  assert.ok(checkBatch(batchHeader + chapters + last).some(issue => issue.code === 'chapter_coverage'));
});

test('容量表按整数或小数万字精确换算，保留全书连续覆盖检查', () => {
  const p = newProject('多卷容量', 'unused', { targetWords: 675000, chapterWords: 2500 });
  const rows = '| 第一卷 | 起势 | 第001—180章 | 180章 | 45万字 | 阶段一 |\n| 第二卷 | 转折 | 181-270 | 90 | 22.5 万字 | 阶段二 |';
  const check = (content: string) => validateCandidate('S05', p, [{ path: paths.volumes, content, baseHash: null }], skill, 'revision').filter(issue => issue.code.startsWith('volume_'));
  assert.deepEqual(check(rows), []);
  assert.deepEqual(check(rows.replace('45万字', '45.00000 万').replace('22.5 万字', '225000字')), []);
  for (const [from, to, code] of [
    ['45万字', '45.0001万字', 'volume_capacity'],
    ['180章 |', '179章 |', 'volume_capacity'],
    ['181-270', '180-269', 'volume_capacity'],
    ['181-270 | 90', '182-271 | 90', 'volume_capacity'],
    ['181-270 | 90 | 22.5', '181-269 | 89 | 22.25', 'volume_total']
  ]) assert.ok(check(rows.replace(from, to)).some(issue => issue.code === code), to);
});

test('容量小数不能表示零点几个字，非法单位与混合表中的坏数值不能漏检', () => {
  const check = (words: string) => validateCandidate('S05', project, [{ path: paths.volumes, content: `| 1 | 起势 | 1-12 | 12 | ${words} | 内容 |`, baseHash: null }], skill, 'revision').filter(issue => issue.code.startsWith('volume_'));
  for (const words of ['3万字', '3.0000万字', '30000字', '30000字（3万字）', '3 万字 (30000字)', '30000字（3.00000万字）']) assert.deepEqual(check(words), [], words);
  for (const words of ['3.00001万字', '30000.5字', '-3万字', '3亿字', '三万字', '9007199254740992字', '3万字左右',
    '30000字（4万字）', '30000字（约3万字）', '30000字（3万字）说明', '30000字（3万字', '30000字（30000.5字）', '30000字（3万字（注））'])
    assert.ok(check(words).some(issue => issue.code === 'volume_ranges'), words);
  const mixed = '| 1 | 起势 | 1-6 | 6 | 1.5万字 | 内容 |\n| 2 | 转折 | 7-12 | 6 | 1.50001万字 | 内容 |';
  assert.ok(validateCandidate('S05', project, [{ path: paths.volumes, content: mixed, baseHash: null }], skill, 'revision').some(issue => issue.code === 'volume_ranges'));
});

const scoreReport = () => scoreFields.map((label, index) => `- ${label}：${index < 3 ? 9 : 8}/10；结合本章动作给出判断。`).join('\n') + '\n- 总分：83/100。';
const qualityIssues = (content: string) => validateCandidate('S10', project, [{ path: qualityPath(1), content, baseHash: null }], skill, 'revision').filter(issue => issue.code === 'quality_score' || issue.code === 'quality_total');

test('死亡权实跑的破折号评分和满分注释有效，不重复要求审稿；实际问题不被删除', () => {
  const actual = fs.readFileSync(path.resolve('tests/fixtures/death-right-review-037.md'), 'utf8');
  for (const content of [actual, actual.replace('88/100——', '88分（满分100分）——')]) {
    assert.equal(computedScore(content), 88);
    assert.equal(declaredTotalScore(content), 88);
    assert.deepEqual(qualityIssues(content), []);
    const change = { path: qualityPath(1), content, baseHash: null };
    const normalized = normalizeCandidate(change).change;
    assert.match(normalized.content, /"verdict":\s*"error"/, '真实审稿发现不能被格式兼容删除');
    assert.equal(normalizeCandidate(normalized).change.content, normalized.content);
    assert.equal(normalizeCandidate({ ...change, path: prosePath(1) }).change.content, content);
  }
});

test('评分说明标点兼容保留原理由，错误量纲、越界和区间仍拒绝', () => {
  for (const value of ['9/10——动作依据。', '9／10—动作依据。', '9分（满分10分）：动作依据。', '9分(满分10分)--动作依据。', '9/10，动作依据。']) {
    const content = scoreReport().replaceAll('9/10；结合本章动作给出判断。', value);
    assert.equal(computedScore(content), 83, value);
    const normalized = normalizeCandidate({ path: qualityPath(1), content, baseHash: null }).change.content;
    assert.match(normalized, /动作依据。/);
    assert.equal(computedScore(normalized), 83);
  }
  for (const value of ['9/15——理由', '9分（满分100分）——理由', '11/10——理由', '-1/10——理由', '9—10', '9——10', '9–10', '9/10——10/10', '9分（满分10分——理由', '9abc——理由'])
    assert.equal(computedScore(scoreReport().replace('9/10；结合本章动作给出判断。', value)), null, value);
  assert.equal(declaredTotalScore(scoreReport().replace('83/100。', '83分（满分10分）——理由')), null);
});

test('质量分数接受分号说明与句末句号，十项分数和总分仍精确核算', () => {
  assert.equal(computedScore(scoreReport()), 83);
  assert.equal(declaredTotalScore(scoreReport()), 83);
  assert.deepEqual(qualityIssues(scoreReport()), []);
  assert.deepEqual(qualityIssues(scoreReport().replaceAll('；', '; ').replace('83/100。', '83 分；十项合计。')), []);
  assert.equal(computedScore(scoreReport().replace('9/10；', '8.5/10；')), 82.5);
  assert.ok(qualityIssues(scoreReport().replace('83/100。', '82/100。')).some(issue => issue.code === 'quality_total'));
  for (const invalid of ['11/10；说明', '-1/10；说明', '9/100；说明', '9/10x', '9，因为不错'])
    assert.equal(computedScore(scoreReport().replace('9/10；结合本章动作给出判断。', invalid)), null, invalid);
  for (const invalid of ['101/100。', '-1/100。', '83/10。', '83/100x'])
    assert.ok(qualityIssues(scoreReport().replace('83/100。', invalid)).some(issue => issue.code === 'quality_total'), invalid);
  assert.equal(computedScore(scoreReport() + `\n- ${scoreFields[0]}：9/10`), null);
  assert.ok(qualityIssues(scoreReport() + '\n- 总分：83/100').some(issue => issue.code === 'quality_total'));
  assert.ok(qualityIssues(scoreReport().replace('- 总分：83/100。', '```md\n- 总分：83/100。\n```')).some(issue => issue.code === 'quality_total'));
});

test('评分规范化保留逐项说明及总分说明，重复规范化不变，正文不改写', () => {
  const content = scoreReport().replaceAll('- ', '* ').replaceAll('：', ': ').replace('83/100。', '82/100；说明保留原文。');
  const change = { path: qualityPath(1), content, baseHash: null };
  const normalized = normalizeCandidate(change);
  assert.equal(computedScore(normalized.change.content), 83);
  assert.match(normalized.change.content, /- 总分：83\/100；说明保留原文。/);
  assert.equal(normalized.change.content.split('；结合本章动作给出判断。').length - 1, 10);
  assert.deepEqual(normalizeCandidate(normalized.change).edits, []);
  assert.equal(normalizeCandidate({ ...change, path: prosePath(1) }, scoreFields).change.content, content);
  const invalid = { ...change, content: scoreReport().replace('9/10；', '11/10；') };
  assert.equal(normalizeCandidate(invalid).change.content, invalid.content);
});

test('格式兼容不替代审核原文证据，仍要求当前正文哈希和五项真实引文', () => {
  const prose = '# 第一章\n他把桌上的收据依次摊开，重新核对每一笔支出。';
  const quote = '他把桌上的收据依次摊开';
  const evidence = { proseHash: hash(prose), checks: reviewAspects.map(aspect => ({ aspect, verdict: 'pass', quote, reason: '原文动作明确，可支持这项审阅判断。' })) };
  const evidenceBlock = (value: typeof evidence) => '\n```json wenxu-review\n' + JSON.stringify(value) + '\n```';
  const check = (report: string) => validateCandidate('S10', project, [
    { path: qualityPath(1), content: report, baseHash: null },
    { path: prosePath(1), content: prose, baseHash: null }
  ], skill, 'revision').filter(issue => issue.code.startsWith('review_'));
  assert.deepEqual(check(scoreReport() + evidenceBlock(evidence)), []);
  assert.ok(check(scoreReport()).some(issue => issue.code === 'review_evidence_missing'));
  assert.ok(check(scoreReport() + evidenceBlock({ ...evidence, proseHash: hash(prose + '改稿') })).some(issue => issue.code === 'review_evidence_stale'));
  assert.ok(check(scoreReport() + evidenceBlock({ ...evidence, checks: evidence.checks.slice(1) })).some(issue => issue.code === 'review_evidence_coverage'));
  assert.ok(check(scoreReport() + evidenceBlock({ ...evidence, checks: evidence.checks.map(item => ({ ...item, quote: '这一句话没有出现在正文中' })) })).some(issue => issue.code === 'review_evidence_quote'));
});
