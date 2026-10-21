import type { Change, Fact, Issue, ProjectState, Run } from '../shared/types';
import type { StoryImpact, StoryStateChange } from '../shared/continuity';
import type { FileStore } from './storage';
import { hash, paths } from './domain';
import { chapterSpan, pastPlanText } from './context-slices';
import { sameStoryText } from './memory-source';
import { candidateChangesForCurrentSettings, currentSettingsSourceHash } from './runtime-settings';

export const isPlan = (file: string) => /^(05_|06_)/.test(file);
export const nextUnwrittenChapter = (p: ProjectState) => Math.max(p.chapter, 1, ...Object.keys(p.chapters).map(n => Number(n) + 1));

export function isFuturePlan(file: string, fromChapter: number) {
  if (!isPlan(file)) return false;
  const span = chapterSpan(file.split('/').at(-1)!);
  return !span || span[1] >= fromChapter;
}

const stateValue = (fact: Fact) => fact.value + (fact.state === 'resolved' ? '（已解决）' : '');

export function changedStoryStates(before: Fact[], after: Fact[]): StoryStateChange[] {
  const byId = new Map(before.map(fact => [fact.id, fact]));
  const groups = new Map<string, Fact[]>();
  const keys = (fact: Fact) => [fact.subject, ...fact.entityIds].map(entity => JSON.stringify([fact.worldId, fact.timelineId, fact.kind, fact.category, entity, fact.predicate]));
  for (const fact of before.filter(f => f.reviewStatus === 'accepted' && !['superseded', 'disputed'].includes(f.state)))
    for (const key of keys(fact)) { const group = groups.get(key) ?? []; group.push(fact); groups.set(key, group); }
  for (const group of groups.values()) group.sort((a, b) => b.fromChapter - a.fromChapter);
  return after.filter(f => f.reviewStatus === 'accepted' && !['superseded', 'disputed'].includes(f.state) &&
    !['plan', 'inference'].includes(f.kind)).flatMap(fact => {
    const previous = byId.get(fact.id) ?? byId.get(fact.supersedes ?? '') ?? keys(fact).flatMap(key =>
      groups.get(key)?.find(f => f.fromChapter <= fact.fromChapter && (f.toChapter === null || f.toChapter >= fact.fromChapter)) ?? [])
      .sort((a, b) => b.fromChapter - a.fromChapter)[0];
    if (previous && previous.kind === fact.kind && previous.subject === fact.subject && previous.predicate === fact.predicate &&
      stateValue(previous) === stateValue(fact) && JSON.stringify(previous.knowledge) === JSON.stringify(fact.knowledge)) return [];
    return [{ factId: fact.id, ...(previous ? { previousFactId: previous.id } : {}), subject: fact.subject, entityIds: fact.entityIds, predicate: fact.predicate,
      before: previous ? stateValue(previous) : null, after: stateValue(fact), fromChapter: fact.fromChapter, toChapter: fact.toChapter,
      evidence: fact.evidence.map(({ path, hash }) => ({ path, hash })) }];
  });
}

/** Evidence narrows the explanation, never silently declares an unindexed plan unaffected. */
export function futurePlanTargets(store: FileStore, fromChapter: number, sources: string[], states: StoryStateChange[], changed: string[], placeholders: Record<string, string>) {
  const documents = store.db.acceptedDocuments().filter(doc => isFuturePlan(doc.path, fromChapter) && !changed.includes(doc.path))
    .map(doc => ({ ...doc, content: store.readAccepted(doc.path).content })).filter(doc => doc.content !== placeholders[doc.path]);
  const eligible = new Set(documents.map(doc => doc.path));
  const trails = new Map<string, string[]>(), queue = [...new Set([...sources, ...states.flatMap(state => [state.factId, ...(state.previousFactId ? [state.previousFactId] : [])])])];
  for (const source of queue) trails.set(source, []);
  const query = store.db.sql.prepare('SELECT DISTINCT dependent FROM dependencies WHERE source_path=?');
  for (let at = 0; at < queue.length; at++) {
    const source = queue[at];
    for (const row of query.all(source)) {
      const dependent = String(row.dependent);
      if (!eligible.has(dependent) || trails.has(dependent)) continue;
      trails.set(dependent, [...trails.get(source)!, source]);
      queue.push(dependent);
    }
  }
  return documents.map(doc => {
    const via = trails.get(doc.path);
    const mentioned = states.filter(state => doc.content.includes(state.subject));
    return { path: doc.path, via: via ?? [], reason: via ? '生成时使用过变更资料或其下游计划' : mentioned.length
      ? `计划提及${[...new Set(mentioned.map(state => state.subject))].join('、')}，需核对状态变化的影响`
      : '后续计划的依赖证据尚不完整，需核对后才能确认不受影响' };
  });
}

export function makeStoryImpact(p: ProjectState, run: Run, changes: Change[], states: StoryStateChange[], targets: StoryImpact['targets'], scope: StoryImpact['scope']): StoryImpact {
  const sources = new Map(states.flatMap(state => state.evidence).map(source => [source.path, source.hash]));
  for (const change of changes.filter(change => /^(0[1-8]_)/.test(change.path))) sources.set(change.path, hash(change.content));
  return { id: `impact-${run.id}`, runId: run.id, revision: p.revision, scope, reason: run.request, stateChanges: states,
    sources: [...sources].map(([path, hash]) => ({ path, hash })), targets };
}

export function resolveStoryImpacts(p: ProjectState, files: string[]) {
  p.storyImpacts = (p.storyImpacts ?? []).map(impact => ({ ...impact, targets: impact.targets.filter(target => !files.includes(target.path)) }))
    .filter(impact => impact.targets.length);
}

export function continuityIssues(store: FileStore, run: Run): Issue[] {
  const issues: Issue[] = [];
  const fail = (message: string, path?: string) => issues.push({ code: 'continuity_scope', severity: 'error', message, path });
  const scope = run.continuity;
  if (scope?.mode === 'forward') {
    if (scope.fromChapter < nextUnwrittenChapter(store.db.project()))
      fail('作品已写到本次生效范围内，请重新建立后续调整或选择故事修订。');
    for (const change of run.changes) {
      if (store.db.document(change.path)?.hash === hash(change.content)) continue;
      const creationRepair = scope.mode === 'forward' && run.memoryRepair?.impacts?.some(impact => impact.creationChange);
      if (!(creationRepair ? /^(03_|04_|05_|06_|11_)/ : /^(04_|05_|06_)/).test(change.path) && change.path !== paths.impact)
        fail('调整后续只允许修改人物约束、未来计划和影响记录；已有正文须另行选择故事修订。', change.path);
      if (isPlan(change.path)) {
        if (!isFuturePlan(change.path, scope.fromChapter)) fail('不能改写生效章节之前的章节设计。', change.path);
        const before = store.db.document(change.path)?.hash ? store.readAccepted(change.path).content : '';
        const previous = pastPlanText(before, scope.fromChapter), proposed = pastPlanText(change.content, scope.fromChapter);
        if (!sameStoryText(previous, proposed)) {
          const oldLines = previous.split('\n'), newLines = proposed.split('\n');
          const first = oldLines.findIndex((line, index) => !sameStoryText(line, newLines[index] ?? ''));
          const at = first < 0 ? oldLines.length : first;
          fail(`后续调整改变了生效章节之前的计划段落，请保留已发生部分。首处差异：原“${(oldLines[at] ?? '无段落').slice(0, 120)}”，新“${(newLines[at] ?? '无段落').slice(0, 120)}”。新增承接说明请放在第${scope.fromChapter}章起或全局分节下。`, change.path);
        }
      }
    }
    for (const fact of run.facts) {
      if (fact.fromChapter < scope.fromChapter) fail('新约束的生效章节早于本次授权范围。');
      if (!['plan', 'author_constraint'].includes(fact.kind)) fail('尚未写出的变化必须登记为计划或作者约定，不能登记为已经发生的事实。');
    }
  }
  if (scope?.mode === 'extraction' && run.changes.some(change => /^(05_|06_|07_|08_)/.test(change.path) && store.db.document(change.path)?.hash !== hash(change.content)))
    fail('纠正记忆提取不能改动大纲或原文；需要改动故事时请选择故事修订。');
  if (run.memoryRepair) {
    for (const [file, expected] of Object.entries(run.memoryRepair.sourceHashes ?? {}))
      if (store.db.document(file)?.hash !== currentSettingsSourceHash(store, run.baseSnapshotId, { path: file, hash: expected }) || store.inspect(file)?.status !== 'accepted')
        fail('关联修订的变更来源已改变，请重新建立核对任务。', file);
    for (const change of run.changes)
      if (!run.memoryRepair.paths.includes(change.path) && !change.path.startsWith('04_') && change.path !== paths.impact)
        fail('关联修订产生了核对范围之外的文件。', change.path);
    const humanText = (content: string) => content.replace(/(?:## 可追溯事实记录\s*)?<!-- wenxu-facts:v1 -->\s*```json\s*\n[\s\S]*?\n```/g, '').trim();
    for (const change of candidateChangesForCurrentSettings(store, run).filter(change => run.memoryRepair!.readonlySources?.includes(change.path))) {
      const before = store.readAccepted(change.path).content;
      const unchanged = change.path.startsWith('04_') ? sameStoryText(humanText(before), humanText(change.content)) : before === change.content;
      if (!unchanged) fail('不能改写已经确认的变更依据来迁就旧计划；请另行提出故事修订。', change.path);
    }
  }
  return issues;
}

export function sortImpactFiles(files: string[]) {
  const rank = (file: string) => file.startsWith('07_') ? 0 : file.startsWith('03_') ? 0.5 : file.startsWith('04_') ? 1 : file === paths.volumes ? 2
    : file === paths.outline ? 3 : file.startsWith('05_') ? 4 : file.startsWith('06_') && /第\d+-\d+章/.test(file) ? 5 : file.startsWith('06_') ? 6 : 7;
  return files.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'zh-CN', { numeric: true }));
}
