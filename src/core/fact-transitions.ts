import type { Fact, Issue } from '../shared/types';
import { compareStoryPosition } from '../shared/story-position';

export function factTransitionIssues(existingIds: Iterable<string>, proposed: Fact[]): Issue[] {
  const seen = new Set(existingIds), issues: Issue[] = [];
  for (const fact of proposed) {
    const add = (message: string) => issues.push({ code: 'fact_transition', severity: 'error', factId: fact.id, message: `${fact.id}：${message}` });
    if (seen.has(fact.id)) add('记忆编号已存在，请新建编号并引用 supersedes');
    if (fact.supersedes) {
      if (!seen.has(fact.supersedes)) add(`被替代记忆不存在或尚未提交：${fact.supersedes}`);
      if (fact.supersedes === fact.id) add('事实不能替代自身');
      if (!fact.replacementReason.trim()) add('替代既有事实必须填写 replacementReason，说明依据和原因');
    }
    seen.add(fact.id);
  }
  return issues;
}

/** Shared by review previews and the atomic adoption path. */
export function supersedeFact(previous: Fact, replacement: Fact) {
  previous.state = 'superseded';
  if (replacement.fromPosition && replacement.fromChapter >= previous.fromChapter &&
      (compareStoryPosition(replacement.fromPosition, previous.fromPosition ?? { chapter: previous.fromChapter }) ?? 1) > 0) {
    previous.untilPosition = replacement.fromPosition;
    previous.toChapter = replacement.fromChapter;
  } else if (replacement.fromChapter <= previous.fromChapter) {
    previous.toChapter = null;
    delete previous.untilPosition;
  } else previous.toChapter = replacement.fromChapter - 1;
}

export function factTransitionPreview(existing: Fact[], proposed: Fact[], retractions: { id: string; reason: string }[] = []) {
  const facts = new Map(existing.map(fact => [fact.id, structuredClone(fact)]));
  const state = (fact: Fact) => ({ state: fact.state, reviewStatus: fact.reviewStatus, toChapter: fact.toChapter, untilPosition: fact.untilPosition });
  const transitions: { id: string; replacementId?: string; reason: string; before: ReturnType<typeof state>; after: ReturnType<typeof state> }[] = [];
  for (const replacement of proposed) {
    const previous = replacement.supersedes ? facts.get(replacement.supersedes) : undefined;
    if (previous) {
      const before = state(previous);
      supersedeFact(previous, replacement);
      transitions.push({ id: previous.id, replacementId: replacement.id, reason: replacement.replacementReason, before, after: state(previous) });
    }
    facts.set(replacement.id, structuredClone(replacement));
  }
  for (const retraction of retractions) {
    const previous = facts.get(retraction.id);
    if (!previous) continue;
    const before = state(previous);
    previous.reviewStatus = 'retracted'; previous.state = 'superseded';
    transitions.push({ id: previous.id, reason: retraction.reason, before, after: state(previous) });
  }
  return transitions;
}
