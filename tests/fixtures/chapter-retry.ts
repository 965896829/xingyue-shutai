import type { Service } from '../../src/core/service';
import { hash, prosePath, qualityPath, requiredInputs, renderProgress, paths } from '../../src/core/domain';
import { fixture } from './workflow';

/** Reproduce the saved chapter state without reading or editing any user project. */
export async function createChapterRetryFixture(service: Service, parent: string, profileId: string) {
  await service.invoke('project.create', { parent, title: '第一章重新生成验收', premise: '事故调查员寻找自己的死亡权。',
    config: { defaultProfileId: profileId, maxRounds: 12, preview: { enabled: false }, expressionRules: { enabled: false } } });
  const store = service.store!, p = store.db.project();
  p.stage = 'S10'; p.revision++;
  store.commit(requiredInputs('S10', p).map(file => service.change(file,
    file === paths.progress ? renderProgress(p) : fixture(p, file, service))), p);
  const run = service.makeRun('stage', '生成第一章正文', profileId);
  const prose = service.change(prosePath(1), fixture(p, prosePath(1), service));
  run.pipeline = { ...run.pipeline!, phase: 'memory', proseHash: hash(prose.content) };
  run.changes = [prose, service.change(qualityPath(1), fixture(p, qualityPath(1), service))];
  run.rounds = 12; run.toolCount = 7; run.status = 'paused';
  run.error = '本次核对已达到请求次数上限，进度已保存';
  run.usage = { input: 1000, output: 300, cost: 0.25, currency: 'USD' };
  store.db.saveRun(run);
  const conversation = service.chat!.records.create('正文生成 · 任务对话', false, run.id);
  const at = new Date().toISOString(), turnId = 'retry-fixture-turn';
  service.chat!.records.save('conversation_turns', { id: turnId, conversationId: conversation.id, messageId: 'retry-fixture-message',
    profileId, profileVersion: service.profiles[0].version, status: 'complete', createdAt: at, updatedAt: at, rules: [], citations: [], messages: [],
    usage: { input: 0, output: 0, cost: 0, currency: 'USD' }, calls: [], budgets: [], kind: 'discussion', request: '重新生成第一章' });
  service.chat!.records.save('conversation_messages', { id: 'retry-fixture-message', conversationId: conversation.id, turnId,
    role: 'assistant', content: '已整理好任务：重新生成当前未采纳的第一章正文。', createdAt: at, status: 'complete', citations: [] });
  const proposal = service.chat!.propose(conversation.id, turnId, profileId, { kind: 'stage',
    goal: '重新生成当前未采纳的第一章正文，并重新核对质量及直接相关记忆候选',
    scope: '仅当前章节的正文、质量评价和相关记忆候选。保留正式资料，不推进阶段。',
    request: '重新生成第一章，保留已有设定。', outputs: [prosePath(1)] });
  return { run, proposal, conversation, p, prose };
}
