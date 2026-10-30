import { z } from 'zod';
import type { AgentRunner } from '../runner';
import { factSchema, type ProjectState, type Run, type SecretProfile, type Issue } from '../../shared/types';
import { chapterCoverageSchema } from '../../shared/chapter-memory';
import { hash, memoryPaths, prosePath, updatePath, qualityPath } from '../domain';
import { requiredCharacterCoverage, validateChapterCoverage, locateCoverageQuotes } from '../chapter-memory';
import { checkReviewEvidence, reviewAspects } from '../manuscript-check';
import { attempts } from '../runtime/model-gateway';
import { fingerprint } from '../runtime/canonical';
import { setRunStatus } from '../runtime/run-state';
import { memoryReviewIssues } from '../memory-review';
import type { FileStore } from '../storage';
import { templates } from '../skill';
import { sameStoryText } from '../memory-source';
import { validateCandidate } from '../validation';

const parse = (raw: string) => JSON.parse(raw.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
export function requiresRevisionCore(store: FileStore, run: Run) {
  return !!run.revisionCoreRequired && !run.revisionCore && !run.pipeline && !run.memoryRepair && run.changes.some(c => c.path.startsWith('07_') && (!store.db.document(c.path)?.hash || !sameStoryText(store.readAccepted(c.path).content, c.content)));
}
export function revisionCoreIssues(store: FileStore, run: Run): Issue[] {
  const core = run.revisionCore;
  if (!core) return [];
  try {
    if (core.version !== 1 || core.phase !== 'ready') throw new Error('修订正文与核心记忆尚未完成核对');
    for (const chapter of core.chapters) {
      const prose = run.changes.find(c => c.path === prosePath(chapter));
      if (!prose || hash(prose.content) !== core.proseHashes[chapter]) throw new Error('修订正文改变，需要重新核对');
      validateChapterCoverage(store, { ...run, chapter, pipeline: { phase: 'ready', proseHash: core.proseHashes[chapter], epoch: run.id, version: 1, previewCalls: 0, coverageVersion: 1 } }, core.coverage[chapter]);
      const issues = checkReviewEvidence(qualityPath(chapter), core.reports[chapter] ?? '', prose.content);
      if (issues.some(i => i.severity === 'error')) throw new Error('修订正文审稿尚未通过');
    }
    if (memoryReviewIssues(store, run).length) throw new Error('修订记忆尚未完成独立证据核对');
    return [];
  } catch (error) { return [{ code: 'revision_core', severity: 'error', message: (error as Error).message }]; }
}
type Host = Pick<AgentRunner, 'store' | 'save' | 'skillRoot' | 'memoryCall' | 'auditMemory' | 'check'>;
export function applyRevisionMemoryRepair(store: FileStore, run: Run, raw: unknown) {
  const core = run.revisionCore!;
  const result = z.object({
    documents: z.array(z.object({ path: z.string(), content: z.string().min(1) }).strict()),
    facts: z.array(factSchema),
    coverages: z.array(z.object({ chapter: z.number().int(), coverage: chapterCoverageSchema }).strict())
  }).strict().parse(raw);
  const allowed = [...memoryPaths, ...core.chapters.map(updatePath)];
  if (new Set(result.documents.map(d => d.path)).size !== result.documents.length || result.documents.some(d => !allowed.includes(d.path))) throw new Error('记忆修复超出允许文件范围');
  if (new Set(result.facts.map(f => f.id)).size !== result.facts.length) throw new Error('记忆修复事实标识重复');
  const targets = run.memoryReview?.targets ?? [];
  const mutableFacts = new Set(targets.flatMap(t => t.factId ? [t.factId] : []));
  for (const fact of run.facts) if (!mutableFacts.has(fact.id) && fingerprint(result.facts.find(f => f.id === fact.id)) !== fingerprint(fact)) throw new Error('记忆修复不能改变未被否定的事实');
  for (const fact of result.facts) if (!run.facts.some(f => f.id === fact.id) && !fact.evidence.some(e => core.chapters.some(chapter => e.path === prosePath(chapter) && e.hash === core.proseHashes[chapter]))) throw new Error('新增记忆缺少最终修订正文证据');
  if (result.coverages.length !== core.chapters.length || new Set(result.coverages.map(c => c.chapter)).size !== core.chapters.length || result.coverages.some(c => !core.chapters.includes(c.chapter))) throw new Error('记忆修复没有覆盖全部修订章节');
  const coverage = Object.fromEntries(result.coverages.map(c => {
    const scoped = { ...run, facts: result.facts, chapter: c.chapter, pipeline: { phase: 'memory' as const, proseHash: core.proseHashes[c.chapter], epoch: run.id, version: 1, previewCalls: 0, coverageVersion: 1 as const } };
    return [c.chapter, validateChapterCoverage(store, scoped, locateCoverageQuotes(scoped, c.coverage))];
  }));
  for (const doc of result.documents) {
    const current = run.changes.find(c => c.path === doc.path);
    if (current) current.content = doc.content;
    else run.changes.push({ ...doc, baseHash: store.db.document(doc.path)?.hash ?? null });
  }
  run.facts = result.facts;
  core.coverage = coverage;
  run.memoryReview = undefined;
}
export async function driveRevisionCore(host: Host, run: Run, project: ProjectState, profile: SecretProfile, signal: AbortSignal) {
  const core = run.revisionCore!;
  if (core.version !== 1) throw new Error('修订工作流版本不受支持');
  setRunStatus(run, 'running'); host.save(run);
  const request = async (phase: string, instruction: string, input: object) => {
    const purpose = `${phase}:${fingerprint(input)}`;
    const prior = attempts(host.store, run.id).findLast(a => a.purpose === purpose && a.status === 'complete');
    if (prior?.responseRef) {
      const response = JSON.parse(host.store.object(prior.responseRef).toString('utf8')).result;
      if (response.stop !== 'complete' || response.calls.length) throw new Error('已保存回执不完整');
      return response.text as string;
    }
    if (attempts(host.store, run.id).some(a => a.status === 'unknown' || a.status === 'dispatching')) throw new Error('上次请求结果未知，请先核对，未自动重发');
    return host.memoryCall(run, project, profile, signal, purpose, instruction, input);
  };
  for (const chapter of core.chapters) {
    const file = prosePath(chapter), prose = run.changes.find(c => c.path === file)!;
    if (hash(prose.content) !== core.proseHashes[chapter]) throw new Error('修订候选已变化');
    const scoped = { ...run, chapter, pipeline: { phase: 'memory' as const, proseHash: core.proseHashes[chapter], epoch: run.id, version: 1, previewCalls: 0, coverageVersion: 1 as const } };
    if (!core.coverage[chapter]) {
      const allowed = [...memoryPaths, updatePath(chapter)];
      const documents = allowed.map(path => ({ path, content: run.changes.find(c => c.path === path)?.content ?? (host.store.db.document(path)?.hash ? host.store.readAccepted(path).content : '') }));
      const input = { chapter, prose: { ...prose, hash: core.proseHashes[chapter] }, requiredCharacters: requiredCharacterCoverage(host.store, scoped), currentFacts: host.store.db.facts(), candidateFacts: run.facts, documents,
        formatRequirements: validateCandidate(run.stage, { ...project, chapter }, documents.map(d => ({ ...d, baseHash: null })), host.skillRoot, 'revision').filter(i => i.severity === 'error').map(i => ({ path: i.path, code: i.code, message: i.message })),
        schemas: { fact: z.toJSONSchema(factSchema), coverage: z.toJSONSchema(chapterCoverageSchema) } };
      const raw = await request(`revision-extract-${chapter}`, '根据修订后正文批量提取人物与核心记忆。不能改写正文。保留未受影响台账原文和事实；错误旧事实用带 supersedes 的新事实替代，不猜测未知。稳定人格与当章情绪分开，误信保留主体。只返回 JSON {documents:[{path,content}],facts:[],coverage:...}。documents 只允许已给路径，包含本章记忆更新；facts 与 coverage 按给定 schema。覆盖全部出场人物，无变化和依据不足也是合法结果。', input);
      const result = z.object({ documents: z.array(z.object({ path: z.string(), content: z.string().min(1) }).strict()).min(1), facts: z.array(factSchema), coverage: chapterCoverageSchema }).strict().parse(parse(raw));
      if (new Set(result.documents.map(d => d.path)).size !== result.documents.length || result.documents.some(d => !allowed.includes(d.path)) || !result.documents.some(d => d.path === updatePath(chapter))) throw new Error('修订记忆输出范围不完整或越界');
      if (new Set(result.facts.map(f => f.id)).size !== result.facts.length || result.facts.some(f => run.facts.some(prior => prior.id === f.id && fingerprint(prior) !== fingerprint(f)))) throw new Error('跨章事实标识冲突，请为新事实使用独立标识');
      const nextFacts = [...run.facts.filter(f => !result.facts.some(next => next.id === f.id)), ...result.facts];
      const coverage = validateChapterCoverage(host.store, { ...scoped, facts: nextFacts }, locateCoverageQuotes(scoped, result.coverage));
      if (fingerprint(coverage) !== fingerprint(result.coverage)) host.store.db.event(run.id, 'evidence-located', '已按本版唯一原文定位人物覆盖坐标');
      for (const doc of result.documents) {
        const existing = run.changes.find(c => c.path === doc.path);
        if (existing) existing.content = doc.content;
        else run.changes.push({ ...doc, baseHash: host.store.db.document(doc.path)?.hash ?? null });
      }
      run.facts = nextFacts; core.coverage[chapter] = coverage; run.memoryReview = undefined; host.save(run);
    }
    if (!core.reports[chapter]) {
      const raw = await request(`revision-review-${chapter}`, `独立审阅最终修订正文。只返回 JSON {report:"完整 Markdown 审稿报告"}。填写输入模板全部字段和十项分数，总分正确；报告附 json wenxu-review 代码块 {proseHash,checks:[{aspect,verdict,quote,reason}]}，checks 恰好五项：${reviewAspects.join('、')}。verdict 为 pass/warning/error；quote 是正文连续原文至少8字，reason 至少8字。故事依据、人物一致性与表达建议分别判断，文学偏好只作为 warning，硬矛盾才是 error。`, { prose: prose.content, proseHash: core.proseHashes[chapter], constraints: project.config.constraints, template: templates(host.skillRoot)['章节质量评分'] });
      const report = z.object({ report: z.string().min(1) }).strict().parse(parse(raw)).report;
      const issues = checkReviewEvidence(qualityPath(chapter), report, prose.content);
      if (issues.some(i => i.severity === 'error')) throw new Error(issues.map(i => i.message).join('；'));
      core.reports[chapter] = report;
      const existing = run.changes.find(c => c.path === qualityPath(chapter));
      if (existing) existing.content = report; else run.changes.push({ path: qualityPath(chapter), content: report, baseHash: host.store.db.document(qualityPath(chapter))?.hash ?? null });
      host.save(run);
    }
  }
  const repairFormat = async () => { for (let attempt = run.repairAttempts?.memory_sync ?? 0; attempt < 3; attempt++) {
    const memory = run.changes.filter(c => c.path.startsWith('04_') || core.chapters.some(chapter => c.path === updatePath(chapter)));
    const errors = core.chapters.flatMap(chapter => validateCandidate(run.stage, { ...project, chapter }, memory, host.skillRoot, 'revision')).filter(i => i.severity === 'error');
    if (!errors.length) break;
    const targets = [...new Set(errors.flatMap(i => i.path ? [i.path] : []))];
    const input = { documents: memory.filter(c => targets.includes(c.path)), errors: [...new Set(errors.map(i => `${i.path}: ${i.message}`))], facts: run.facts, prose: run.changes.filter(c => c.path.startsWith('07_')), instruction: '仅修正列出的文档格式。保留明确事实与人物标识，不发明人格、经历或事件。不要改变正文、facts 或 coverage。叙事状态与候选采纳状态分开：关系极性只用 positive/neutral/negative/ambiguous；伏笔状态只用已埋/推进中/已回收/已废弃。未知关系或伏笔不伪造表格数据行，只保留表头；信任度未知填未评估。' };
    const raw = await request(`revision-format-${attempt + 1}`, '只返回 JSON {documents:[{path,content}]}，包含每个待修复文件的完整 Markdown。依据输入 errors 修复字段与分节。禁止改变已核验的事实含义和原文。', input);
    const fixed = z.object({ documents: z.array(z.object({ path: z.string(), content: z.string().min(1) }).strict()) }).strict().parse(parse(raw));
    if (new Set(fixed.documents.map(d => d.path)).size !== targets.length || fixed.documents.some(d => !targets.includes(d.path))) throw new Error('记忆格式修复越界或缺少文档');
    for (const doc of fixed.documents) run.changes.find(c => c.path === doc.path)!.content = doc.content;
    (run.repairAttempts ??= {}).memory_sync = attempt + 1;
    run.memoryReview = undefined; host.save(run);
  } };
  await repairFormat();
  core.phase = 'review'; host.save(run);
  await host.auditMemory(run, project, profile, signal);
  for (let attempt = run.repairAttempts?.revision_memory ?? 0; run.memoryReview?.issues.length && attempt < 2; attempt++) {
    const input = { chapters: core.chapters, prose: run.changes.filter(c => c.path.startsWith('07_')), proseHashes: core.proseHashes,
      documents: run.changes.filter(c => memoryPaths.some(path => path === c.path) || core.chapters.some(chapter => c.path === updatePath(chapter))),
      facts: run.facts, currentFacts: host.store.db.facts(), coverage: core.coverage, review: run.memoryReview,
      schemas: { fact: z.toJSONSchema(factSchema), coverage: z.toJSONSchema(chapterCoverageSchema) } };
    const raw = await request(`revision-memory-repair-${attempt + 1}`, '根据独立核对指出的问题定向修复记忆和人物覆盖，绝对不能改写正文。只返回 JSON {documents:[{path,content}],facts:[],coverages:[{chapter,coverage}]}。facts 返回完整候选事实，未被审核否定的既有候选事实须逐字段保留；缺少的人物允许无变化、依据不足、仅提及，不强制新增事实。coverages 覆盖每个修订章节，含未具名但出场的人员，使用来源可追溯的稳定标识。documents 仅返回需修正的记忆台账及章后更新，不返回正文或审稿。不得声称另一份不存在的记录已完成核对。', input);
    applyRevisionMemoryRepair(host.store, run, parse(raw));
    (run.repairAttempts ??= {}).revision_memory = attempt + 1; host.save(run);
    await repairFormat();
    await host.auditMemory(run, project, profile, signal);
  }
  core.phase = 'ready'; host.check(run, project);
  run.responseText = '修订正文与人物记忆已准备好。';
  setRunStatus(run, run.issues.some(i => i.severity === 'error') ? 'needs_repair' : 'awaiting_review'); host.save(run);
}
