import type { FileStore } from './storage';
import { readQuality } from './quality';
import { applicableFact, sourceValidator } from './memory-studio';
import { memoryScopeSchema } from '../shared/studio';
import { experienceSchema, maxExperienceChapter } from '../shared/experience';

export function readExperience(store: FileStore, throughChapter: number) {
  if (!Number.isInteger(throughChapter) || throughChapter < 1 || throughChapter > maxExperienceChapter)
    throw new Error('阅读回看章节无效');
  const snapshot = store.db.headRef()!,
    info = store.db.snapshotInfo(snapshot.id);
  const validSource = sourceValidator(store, info.documents, throughChapter, store.db.project());
  const facts = store.db
    .facts({ worldId: 'main', timelineId: 'main' })
    .filter(
      (f) =>
        applicableFact(f, memoryScopeSchema.parse({ chapter: f.fromChapter, ...(f.fromPosition ? { position: f.fromPosition } : {}) })) &&
        f.fromChapter <= throughChapter &&
        f.evidence.every(validSource)
    );
  const item = (f: (typeof facts)[number]) => ({
    id: f.id,
    text: `${f.subject} · ${f.predicate}：${f.value}`,
    source: f.evidence[0]?.path ?? '',
    stale: false
  });
  const chapters = new Map<number, { chapter: number; planned: ReturnType<typeof item>[]; realized: ReturnType<typeof item>[]; simulated: ReturnType<typeof item>[]; feedback: ReturnType<typeof item>[] }>();
  const atChapter = (chapter: number) => {
    if (!chapters.has(chapter)) chapters.set(chapter, { chapter, planned: [], realized: [], simulated: [], feedback: [] });
    return chapters.get(chapter)!;
  };
  for (const fact of facts) {
    if (fact.fromChapter < 1) continue;
    if (['plan', 'author_constraint'].includes(fact.kind)) atChapter(fact.fromChapter).planned.push(item(fact));
    else if (fact.kind === 'event') atChapter(fact.fromChapter).realized.push(item(fact));
  }
  for (const run of store.db.runs()) {
    const creative = run.creative;
    if (
      creative?.input.operation !== 'first-read' ||
      !creative.result ||
      creative.input.throughChapter > throughChapter
    )
      continue;
    atChapter(creative.input.throughChapter).simulated.push({
      id: run.id,
      text: creative.result.content,
      source: '',
      stale: creative.sourceVersions.some((v) => store.db.document(v.path)?.hash !== v.hash)
    });
  }
  const feedback: ReturnType<typeof item>[] = [];
  try {
    const quality = readQuality(store);
    for (const observation of quality.observations.filter(
      (o) => o.state === 'active' && !o.excluded && o.origin !== 'model_simulation'
    )) {
      const presentation = quality.presentations.find((p) => p.id === observation.presentationId),
        experiment = quality.experiments.find((e) => e.id === presentation?.experimentId);
      const origins = { human_author: '作者', human_target_reader: '目标读者', model_simulation: '模型模拟' };
      feedback.push({
        id: observation.id,
        text: `${experiment?.title ?? '对比试读'} · ${origins[observation.origin]}：${observation.reason || { preferred: '偏好已选样稿', tie: '平局', both_unsatisfactory: '都不满意', abstained: '弃权' }[observation.outcome]}`,
        source: '作品试读',
        stale: false
      });
    }
  } catch {}
  const identities = [
    ...new Set(
      facts
        .filter((f) => f.category === 'character')
        .flatMap((f) => (f.entityIds.length ? f.entityIds : [f.subject]))
    )
  ];
  const characters = identities.map((id) => {
    const own = facts.filter((f) => f.entityIds.includes(id) || f.subject === id),
      current = own.filter((f) => applicableFact(f, memoryScopeSchema.parse({ chapter: throughChapter })));
    return {
      id,
      name: own[0]?.subject ?? id,
      stable: current.filter((f) => f.characterLayer === 'stable' || ['world_rule', 'author_constraint'].includes(f.kind)).map(item),
      current: current.filter((f) => f.characterLayer !== 'stable' && f.characterLayer !== 'experience' && !['world_rule', 'author_constraint', 'plan', 'expression_sample'].includes(f.kind)).map(item),
      experiences: own.filter(f => f.kind === 'event' || f.characterLayer === 'experience').map(item)
    };
  });
  return experienceSchema.parse({ snapshotId: snapshot.id, chapters: [...chapters.values()].sort((a, b) => a.chapter - b.chapter), characters, feedback });
}
