import { chapterCoverageSchema, type ChapterCoverage } from '../shared/chapter-memory';
import type { Run, ToolDefinition } from '../shared/types';
import type { FileStore } from './storage';
import { hash, paths, prosePath } from './domain';
import { z } from 'zod';
import { parseCharacterCards } from './manuscript-view';
import { decodeFacts, primaryPath } from './memory-records';
import type { Change } from '../shared/types';
import { fingerprint } from './runtime/canonical';

export const chapterCoverageInstruction =
  '\n章后记忆完成时在 propose_memory 或含 facts 的 propose_changes 中一并提交 coverage（schemaVersion:1、proseHash、characters）。批量检查最终正文中所有出场人物及仅提及人物，不逐人请求。每人包含稳定 entityId、name、outcome、reason、factIds 和原文 evidence（quote/start/end，Unicode 码点坐标，起含止不含）。outcome 为 changed、reviewed_no_change、insufficient_evidence 或 mentioned_only。改变须引用本轮实际事实；允许无变化和依据不足，不能把一时情绪改成稳定人格。人物误信属于其主观信念，不用作者真相替换。全部正文和覆盖必须经独立审核后同版采纳。';

export function withChapterCoverageTools(run: Run, tools: ToolDefinition[]) {
  if (run.pipeline?.coverageVersion !== 1 || run.pipeline.phase !== 'memory') return tools;
  const schema = z.toJSONSchema(chapterCoverageSchema, { target: 'draft-7' });
  delete schema.$schema;
  return tools.map((tool) =>
    ['propose_changes', 'propose_memory'].includes(tool.name)
      ? {
          ...tool,
          parameters: {
            ...tool.parameters,
            properties: { ...(tool.parameters.properties as object), coverage: {
              ...schema,
              description: '本章人物覆盖记录。complete:true 时须一并提交；只有已保存且与本章最终正文、当前事实一致的 coverage 可以复用。changed 必须引用本批真实事实 ID，其他 outcome 的 factIds 必须为空。'
            } }
          }
        }
      : tool
  );
}

export function requiredCharacterCoverage(store: FileStore, run: Run) {
  const prose = run.changes.find((change) => change.path === prosePath(run.chapter))?.content ?? '';
  const result = new Map<string, { entityId: string; name: string }>();
  const roles = store.db.document(paths.roles);
  if (roles?.hash) {
    const content = store.object(roles.hash).toString('utf8');
    for (const character of parseCharacterCards({
      path: paths.roles,
      hash: roles.hash,
      content,
      track: 'saved'
    }))
      if ([character.name, ...character.aliases].some((name) => name && prose.includes(name)))
        result.set(character.id, { entityId: character.id, name: character.name });
  }
  for (const fact of [...store.db.facts({ worldId: 'main', timelineId: 'main' }), ...run.facts]) {
    if (fact.worldId !== 'main' || fact.timelineId !== 'main' || fact.fromChapter > run.chapter ||
      (fact.toChapter !== null && fact.toChapter < run.chapter) ||
      fact.category !== 'character' || fact.reviewStatus === 'retracted' || ['superseded', 'disputed'].includes(fact.state))
      continue;
    if (![fact.subject, ...fact.aliases].some((name) => name && prose.includes(name))) continue;
    const entityId = fact.entityIds[0] || `entity-${hash(`${fact.worldId}:${fact.subject}`).slice(0, 24)}`;
    for (const [key, character] of result)
      if (character.name === fact.subject && key !== entityId) result.delete(key);
    result.set(entityId, { entityId, name: fact.subject });
  }
  return [...result.values()];
}

export function validateChapterCoverage(store: FileStore, run: Run, raw: unknown): ChapterCoverage {
  if (raw === undefined || raw === null)
    throw new Error('本章尚未提交人物覆盖记录；请在 propose_changes 或 propose_memory 中一并提交 coverage，再标记 complete:true');
  const parsed = chapterCoverageSchema.safeParse(raw);
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map(issue => issue.path.join('.') || 'coverage'))];
    throw new Error(`人物覆盖字段不完整或格式不正确，请按 coverage 结构修正：${fields.join('、')}`);
  }
  const coverage = parsed.data;
  const prose = run.changes.find((change) => change.path === prosePath(run.chapter));
  if (!prose || coverage.proseHash !== hash(prose.content) || coverage.proseHash !== run.pipeline?.proseHash)
    throw new Error('人物覆盖与最终正文版本不一致，须重新提取与核验');
  const points = Array.from(prose.content),
    seen = new Set<string>();
  for (const character of coverage.characters) {
    if (seen.has(character.entityId)) throw new Error('人物覆盖不能重复登记同一人物');
    seen.add(character.entityId);
    if (character.outcome === 'changed' ? !character.factIds.length : !!character.factIds.length)
      throw new Error(`人物“${character.name}”的覆盖状态与事实引用不一致：changed 必须引用本章已提交的事实 ID，其他状态的 factIds 必须为空`);
    for (const evidence of character.evidence) {
      if (points.slice(evidence.start, evidence.end).join('') !== evidence.quote)
        throw new Error('人物覆盖证据与正文坐标不一致');
    }
    for (const factId of character.factIds) {
      const fact = run.facts.find((f) => f.id === factId);
      if (
        !fact ||
        !(fact.entityIds.includes(character.entityId) || fact.subject === character.name) ||
        !fact.evidence.some((e) => e.path === prose.path && e.hash === coverage.proseHash)
      )
        throw new Error('人物变化缺少本章同版本事实依据');
    }
  }
  if (requiredCharacterCoverage(store, run).some((character) => !seen.has(character.entityId)))
    throw new Error('人物覆盖遗漏本章出现的已登记人物');
  return coverage;
}

export function locateCoverageQuotes(run: Run, raw: unknown) {
  const coverage = chapterCoverageSchema.parse(raw), prose = run.changes.find(c => c.path === prosePath(run.chapter));
  if (!prose || hash(prose.content) !== coverage.proseHash) return coverage;
  const points = Array.from(prose.content);
  for (const character of coverage.characters) for (const evidence of character.evidence) {
    if (points.slice(evidence.start, evidence.end).join('') === evidence.quote) continue;
    const offset = prose.content.indexOf(evidence.quote);
    if (offset < 0 || prose.content.indexOf(evidence.quote, offset + 1) >= 0) continue;
    evidence.start = Array.from(prose.content.slice(0, offset)).length;
    evidence.end = evidence.start + Array.from(evidence.quote).length;
  }
  return coverage;
}

export function chapterCoverageIssues(store: FileStore, run: Run) {
  if (run.pipeline?.coverageVersion !== 1 || !['memory', 'ready'].includes(run.pipeline.phase)) return [];
  try {
    validateChapterCoverage(store, run, run.chapterCoverage);
    return [];
  } catch (error) {
    return [
      {
        code: 'chapter_coverage',
        severity: 'error' as const,
        path: prosePath(run.chapter),
        message: error instanceof z.ZodError ? '本章尚未提交完整人物覆盖记录' : (error as Error).message
      }
    ];
  }
}

export function assertCoreMemoryIncluded(run: Run, changes: Change[]) {
  const ledgers = new Map<string, ReturnType<typeof decodeFacts>>();
  for (const fact of run.facts) {
    const path = primaryPath(fact);
    if (!ledgers.has(path))
      ledgers.set(path, decodeFacts(changes.find((change) => change.path === path)?.content ?? ''));
    const stored = ledgers.get(path)!.find((row) => row.id === fact.id);
    if (
      !stored ||
      stored.reviewStatus !== 'accepted' ||
      stored.acceptedRunId !== run.id ||
      fingerprint({
        ...fact,
        reviewStatus: 'accepted',
        acceptedAt: stored.acceptedAt,
        acceptedRunId: run.id
      }) !== fingerprint(stored)
    )
      throw new Error('本章核心记忆未完整包含在同一正式提交中');
  }
}
