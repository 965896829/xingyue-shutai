import type { FileStore } from './storage';
import { readQuality } from './quality';
import { sourceValidator } from './memory-studio';
import { experienceSchema } from '../shared/experience';

export function readExperience(store: FileStore, throughChapter: number) {
  const snapshot = store.db.headRef()!,
    info = store.db.snapshotInfo(snapshot.id);
  const validSource = sourceValidator(store, info.documents, throughChapter, store.db.project());
  const facts = store.db
    .facts({ worldId: 'main', timelineId: 'main' })
    .filter(
      (f) =>
        f.reviewStatus === 'accepted' &&
        !['disputed', 'superseded'].includes(f.state) &&
        f.fromChapter <= throughChapter &&
        f.evidence.every(validSource)
    );
  const item = (f: (typeof facts)[number]) => ({
    id: f.id,
    text: `${f.subject} · ${f.predicate}：${f.value}`,
    source: f.evidence[0]?.path ?? '',
    stale: false
  });
  const chapters = Array.from({ length: throughChapter }, (_, i) => ({
    chapter: i + 1,
    planned: facts
      .filter((f) => f.fromChapter === i + 1 && ['plan', 'author_constraint'].includes(f.kind))
      .map(item),
    realized: facts.filter((f) => f.fromChapter === i + 1 && f.kind === 'event').map(item),
    simulated: [] as ReturnType<typeof item>[],
    feedback: [] as ReturnType<typeof item>[]
  }));
  for (const run of store.db.runs()) {
    const creative = run.creative;
    if (
      creative?.input.operation !== 'first-read' ||
      !creative.result ||
      creative.input.throughChapter > throughChapter
    )
      continue;
    chapters[creative.input.throughChapter - 1].simulated.push({
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
      current = own.filter((f) => f.toChapter === null || f.toChapter >= throughChapter);
    return {
      id,
      name: own[0]?.subject ?? id,
      stable: current.filter((f) => ['world_rule', 'author_constraint'].includes(f.kind)).map(item),
      current: current.filter((f) => !['world_rule', 'author_constraint', 'plan'].includes(f.kind)).map(item)
    };
  });
  return experienceSchema.parse({ snapshotId: snapshot.id, chapters, characters, feedback });
}
