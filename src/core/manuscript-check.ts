import { countWords, hash } from './domain';
import { extractProseBody } from './prose-body';
import { z } from 'zod';
import type { Issue, ProjectConfig, ProjectState } from '../shared/types';

export const reviewAspects = ['开头有效性', '主角主动性', '人物一致性', '信息落地', '章末牵引'] as const;
const reviewEvidence = z.object({
  proseHash: z.string().regex(/^[a-f0-9]{64}$/),
  checks: z.array(z.object({
    aspect: z.string().trim().min(1).max(80),
    verdict: z.enum(['pass', 'warning', 'error']),
    quote: z.string().min(8).max(1200),
    reason: z.string().trim().min(8).max(2000)
  })).max(32)
});

export function assessReviewEvidence(file: string, report: string, prose: string) {
  const blocks = [...report.matchAll(/^```json wenxu-review[\t ]*\r?\n([\s\S]*?)^```[\t ]*$/gm)];
  let value: z.infer<typeof reviewEvidence>;
  try {
    if (blocks.length !== 1) throw new Error();
    value = reviewEvidence.parse(JSON.parse(blocks[0][1]));
  } catch {
    return { validationIssues: [{ code: 'review_evidence_missing', severity: 'error', path: file, message: '审稿缺少完整的原文依据，需补齐五项判断、引文和理由。' }] as Issue[], findings: [] as Issue[] };
  }
  const issues: Issue[] = [];
  const findings: Issue[] = [];
  if (value.proseHash !== hash(prose))
    issues.push({ code: 'review_evidence_stale', severity: 'error', path: file, message: '审稿对应的正文已经变化，请重新审阅当前稿。' });
  if (value.checks.length !== reviewAspects.length || reviewAspects.some(aspect => value.checks.filter(check => check.aspect === aspect).length !== 1))
    issues.push({ code: 'review_evidence_coverage', severity: 'error', path: file, message: `审稿核验恰好需要“${reviewAspects.join('、')}”五项，且每项只出现一次；当前填写 ${value.checks.length} 项，存在新增、重复或遗漏。其他建议写入中文报告，将 warning/error 归入对应核心维度，不另增维度。` });
  for (const check of value.checks) {
    if (!prose.includes(check.quote))
      issues.push({ code: 'review_evidence_quote', severity: 'error', path: file, message: `“${check.aspect}”引用的文字不在当前正文中，请重新核对。` });
    if (check.verdict !== 'pass')
      findings.push({ code: 'review_finding', severity: check.verdict, path: file, message: `${check.aspect}：${check.reason}` });
  }
  return { validationIssues: issues, findings };
}

export function checkReviewEvidence(file: string, report: string, prose: string): Issue[] {
  const assessment = assessReviewEvidence(file, report, prose);
  return [...assessment.validationIssues, ...assessment.findings];
}

export function checkProse(file: string, content: string, config: ProjectConfig): Issue[] {
  const issues: Issue[] = [];
  const body = extractProseBody(content);
  const compact = body.replace(/\s/gu, '');
  const count = countWords(content);
  if (count < config.minWords || count > config.maxWords)
    issues.push({ code: 'word_count', severity: 'error', path: file, message: `正文 ${count} 字，允许范围 ${config.minWords}—${config.maxWords}（排除明确的首章标题、空白）` });
  if (!compact || /^(?:待填写|待生成|待补充|TODO|TBD)[。.!！]?$/i.test(compact) || /^\s*(?:-\s*)?状态[：:]\s*待生成\s*$/m.test(body) || /^## 内容\s*\n\s*待填写/m.test(body))
    issues.push({ code: 'prose_placeholder', severity: 'error', path: file, message: '正文仍是占位内容，请先完成本章写作。' });
  const repeated = /([\p{L}\p{N}])\1{39,}/u.exec(compact);
  if (repeated)
    issues.push({ code: 'prose_repetition', severity: 'error', path: file, message: '正文出现连续至少 40 个相同文字，可能生成异常，请核对原文。' });
  const paragraphs = body.split(/\r?\n/).map(line => line.replace(/\s/gu, '')).filter(line => Array.from(line).length >= 40);
  const counts = new Map<string, number>();
  let duplicated = 0;
  for (const paragraph of paragraphs) {
    const previous = counts.get(paragraph) ?? 0;
    counts.set(paragraph, previous + 1);
    if (previous) duplicated += Array.from(paragraph).length;
  }
  if (duplicated >= 200 && duplicated > count / 2)
    issues.push({ code: 'prose_duplicate_paragraphs', severity: 'error', path: file, message: '超过一半正文来自整段重复，可能发生循环生成，请先修订。' });
  if (/\uFFFD/.test(content))
    issues.push({ code: 'prose_encoding', severity: 'error', path: file, message: '正文含损坏字符，请检查编码。' });
  return issues;
}

export function checkPublication(p: ProjectState, documents: { path: string; content: string }[]): Issue[] {
  return documents.flatMap(doc => {
    const chapter = doc.path.match(/^07_正文章节\/第(\d+)章\.md$/);
    if (!chapter) return [];
    const issues = checkProse(doc.path, doc.content, p.config);
    const state = p.chapters[Number(chapter[1])];
    if (p.stale.includes(doc.path) || state === 'stale')
      issues.push({ code: 'publication_stale', severity: 'error', path: doc.path, message: '前文修订后本章尚未核对，请先处理改动影响。' });
    else if (state !== 'complete')
      issues.push({ code: 'publication_incomplete', severity: 'error', path: doc.path, message: '本章尚未完成正文审阅与章后核对，请完成后再导出正式文稿。' });
    return issues;
  });
}
