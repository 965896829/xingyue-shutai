import type { Service } from '../../src/core/service';
import type { Fact, Run } from '../../src/shared/types';
import { requiredCharacterCoverage } from '../../src/core/chapter-memory';
import { prosePath, hash } from '../../src/core/domain';
import type { ChapterCoverage } from '../../src/shared/chapter-memory';

export function fixtureCoverage(service: Service, run: Run, facts: Fact[] = run.facts): ChapterCoverage {
  const prose = run.changes.find((change) => change.path === prosePath(run.chapter))!.content;
  const quote = Array.from(prose).slice(0, 120).join('');
  return {
    schemaVersion: 1,
    proseHash: hash(prose),
    characters: requiredCharacterCoverage(service.store!, { ...run, facts }).map((character) => {
      const factIds = facts.filter(fact => fact.subject === character.name || fact.entityIds.includes(character.entityId)).map(fact => fact.id);
      return {
        ...character,
        outcome: factIds.length ? 'changed' : 'insufficient_evidence',
        reason: factIds.length ? '离线样稿中的行动已有同版本事实记录。' : '离线样稿只验证来源和覆盖，没有新增稳定人格的依据。',
        factIds,
        evidence: [{ quote, start: 0, end: Array.from(quote).length }]
      };
    })
  };
}

export function fixtureAuditEvidence(item: { fact?: { evidence: { path: string; quote: string }[] }; path?: string }, sources: { path: string; content: string }[]) {
  if (item.fact) return item.fact.evidence.map(({ path, quote }) => ({ path, quote }));
  const source = sources.find(source => source.path === item.path)!;
  return [{ path: source.path, quote: Array.from(source.content).slice(0, 120).join('') }];
}
