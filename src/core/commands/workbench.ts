import { z } from 'zod';
import type { Service } from '../service';
import type { Command } from '../../shared/types';
import { workbenchBindingSchema } from '../../shared/workbench';
import { workbenchScopeBindingSchema } from '../../shared/workbench-visual';
import { memoryScopeSchema } from '../../shared/studio';
import {
  readWorkbench,
  proposeWorkbenchField,
  resolveWorkbenchObject,
  setWorkbenchLock,
  workbenchFactsAt
} from '../workbench';
import { mutatePlot, readPlot } from '../workbench-plot';
import {
  currentWorkbenchScope,
  prepareReorder,
  validateReorderDecisions,
  resolvedReorderChanges
} from '../workbench-reorder';
import { bindWorkbenchCandidate, candidateGroups, candidateView, worldImpact } from '../workbench-candidates';
import { workbenchHistory } from '../workbench-history';
import { readAvatar, proposeAvatar } from '../workbench-media';
import { fingerprint } from '../runtime/canonical';
import { id, now } from '../domain';
import { proposalHash } from '../storage';
import { scopeSnapshot, sourceValidator, conflictingFacts } from '../memory-studio';
import { handleAdoptionCommand } from './adoption';

export const workbenchCommands = new Set<string>([
  'workbench.read',
  'workbench.field',
  'workbench.lock',
  'workbench.discuss',
  'workbench.plot',
  'workbench.plotPropose',
  'workbench.reorderPreview',
  'workbench.reorderPropose',
  'workbench.history',
  'workbench.avatar',
  'workbench.avatarPropose',
  'workbench.candidates',
  'workbench.accept',
  'workbench.branch',
  'workbench.worldImpact'
]);
export async function handleWorkbenchCommand(
  host: Service,
  command: Command,
  a: Record<string, unknown>,
  idle: () => void
): Promise<unknown> {
  const { s } = host.require();
  if (command === 'workbench.read') return readWorkbench(s, a.scope);
  if (command === 'workbench.history')
    return workbenchHistory(s, a.binding, a.compareSnapshotId as string | undefined);
  if (command === 'workbench.avatar') return readAvatar(s, a.binding);
  if (command === 'workbench.plot') {
    const scope = memoryScopeSchema.parse(a.scope),
      snapshot = scopeSnapshot(s, scope);
    if (!snapshot) throw new Error('作品尚无可读版本');
    const valid = sourceValidator(s, snapshot.documents, scope.chapter, snapshot.project);
    const facts = workbenchFactsAt(snapshot.facts, scope),
      conflicts = conflictingFacts(facts);
    return readPlot(
      s,
      snapshot,
      scope,
      scope.mode === 'current' && scope.viewpoint === 'author' && scope.chapter >= snapshot.project.chapter,
      facts.filter((f) => !conflicts.has(f.id) && f.evidence.length && f.evidence.every(valid)),
      Number(a.chapter)
    );
  }
  if (command === 'workbench.candidates') {
    const binding = workbenchScopeBindingSchema.parse(a.binding);
    currentWorkbenchScope(s, binding);
    const object = a.objectId
      ? resolveWorkbenchObject(s, { ...binding, objectId: a.objectId }).object
      : undefined;
    if (a.objectId && !object) throw new Error('对象不在当前范围');
    const paths = new Set(object?.fields.map((f) => f.source.path) ?? []);
    return s.db
      .runs()
      .filter(
        (r) =>
          !r.accepted &&
          ['awaiting_review', 'needs_repair'].includes(r.status) &&
          r.changes.length &&
          (!a.objectId ||
            (r.workbench
              ? r.workbench.objectIds.includes(String(a.objectId))
              : r.changes.some((c) => paths.has(c.path))))
      )
      .map((r) => candidateView(s, r));
  }
  if (command === 'workbench.worldImpact') {
    currentWorkbenchScope(s, a.binding);
    return worldImpact(s, String(a.moduleId));
  }
  idle();
  if (command === 'workbench.field') {
    const binding = workbenchBindingSchema.parse(a.binding),
      fieldId = z.string().parse(a.fieldId);
    const change = proposeWorkbenchField(s, binding, fieldId, z.string().parse(a.value));
    const run = host.makeRun('manual', '修改对象字段');
    run.changes = [change];
    bindWorkbenchCandidate(
      s,
      run,
      'field',
      [binding.objectId],
      [{ objectId: binding.objectId, fieldId, path: change.path }]
    );
    s.db.saveRun(run);
    return run.id;
  }
  if (command === 'workbench.lock')
    return setWorkbenchLock(s, a.binding, String(a.fieldId), a.locked === true);
  if (command === 'workbench.discuss') {
    const { binding, object } = resolveWorkbenchObject(s, a.binding),
      records = host.chat!.records;
    const prior = records
      .all('conversations')
      .find((c) => !c.archived && c.objectBinding && fingerprint(c.objectBinding) === fingerprint(binding));
    if (prior) return prior;
    const label = binding.fieldId ? object.fields.find((f) => f.id === binding.fieldId)!.label : '共创';
    return records.save('conversations', {
      ...records.create(`${object.title} · ${label}`, false),
      objectBinding: binding
    });
  }
  if (command === 'workbench.plotPropose') {
    currentWorkbenchScope(s, a.binding);
    const change = mutatePlot(s, a.baseHash as string | null, a.mutation),
      run = host.makeRun('manual', '调整剧情结构');
    run.changes = [change];
    const mutation = a.mutation as {
      kind: string;
      scene?: { id: string };
      link?: { from: string; to: string };
      id?: string;
    };
    bindWorkbenchCandidate(
      s,
      run,
      'plot',
      mutation.scene
        ? [`scene:${mutation.scene.id}`]
        : mutation.link
          ? [mutation.link.from, mutation.link.to]
          : [`scene:${mutation.id}`]
    );
    s.db.saveRun(run);
    return run.id;
  }
  if (command === 'workbench.reorderPreview' || command === 'workbench.reorderPropose') {
    const result = prepareReorder(s, a.binding, a.order as number[]);
    if (command === 'workbench.reorderPreview') return result.preview;
    if (a.fingerprint !== result.preview.fingerprint) throw new Error('章节依赖已改变，请重新预览');
    const decisions = validateReorderDecisions(result.preview, a.decisions as never);
    const run = host.makeRun('manual', '调整章节顺序');
    run.changes = resolvedReorderChanges(result, decisions);
    const metadata = bindWorkbenchCandidate(
      s,
      run,
      'reorder',
      result.preview.before.map((n) => `chapter:${n}`)
    );
    metadata.sourceHashes = result.sourceHashes;
    metadata.reorder = {
      before: result.preview.before,
      after: result.preview.after,
      fingerprint: result.preview.fingerprint,
      decisions
    };
    if (result.preview.requiresRevision)
      run.continuity = { mode: 'retcon', fromChapter: Math.min(...result.preview.before) };
    s.db.saveRun(run);
    return run.id;
  }
  if (command === 'workbench.avatarPropose') {
    const binding = workbenchBindingSchema.parse(a.binding),
      run = host.makeRun('manual', '更新人物头像');
    run.changes = [
      proposeAvatar(s, binding, a.dataUrl as string | null, String(a.name), a.revealedAt as number | null)
    ];
    bindWorkbenchCandidate(s, run, 'media', [binding.objectId]);
    s.db.saveRun(run);
    return run.id;
  }
  if (command === 'workbench.accept' || command === 'workbench.branch') {
    const run = s.db.run(String(a.id));
    if (proposalHash(run) !== a.fingerprint) throw new Error('候选已改变，请重新读取');
    if (command === 'workbench.accept') {
      const groups = candidateGroups(run),
        selected = z.array(z.string()).parse(a.groups);
      if (new Set(selected).size !== groups.length || groups.some((g) => !selected.includes(g.id)))
        throw new Error('关联修改必须一起采纳');
      await handleAdoptionCommand(host, 'run.accept', { id: run.id, proposalHash: a.fingerprint }, idle);
      return true;
    }
    const records = host.chat!.records,
      prior = s.db.get<{ fingerprint: string; draftId: string } | null>(`workbench-branch:${run.id}`);
    if (prior?.fingerprint === a.fingerprint) return records.get('draft_artifacts', prior.draftId);
    const conversation = records.create(String(a.title), false);
    const content = `# ${a.title}\n\n${run.changes.map((c) => `## ${c.path}\n\n${c.content}`).join('\n\n')}\n`;
    const message = records.save('conversation_messages', {
      id: id(),
      conversationId: conversation.id,
      turnId: '',
      role: 'assistant',
      content,
      status: 'complete',
      createdAt: now(),
      citations: []
    });
    const draft = records.saveDraft({
      title: String(a.title),
      content,
      conversationId: conversation.id,
      messageId: message.id
    });
    s.db.set(`workbench-branch:${run.id}`, { fingerprint: a.fingerprint, draftId: draft.id });
    return draft;
  }
  throw new Error('不支持的画布操作');
}
