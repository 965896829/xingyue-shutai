import { z } from 'zod';
import type { AgentRunner } from '../runner';
import type { Run, ProjectState, SecretProfile } from '../../shared/types';
import { creativeOperations } from '../../shared/creative';
import { compileCreative } from '../creative-context';
import { hash, now } from '../domain';
import { fingerprint } from '../runtime/canonical';
import { callModel } from '../runtime/model-gateway';
import { attempts } from '../runtime/model-gateway';
import { setRunStatus } from '../runtime/run-state';
import { recordUsage, requestGuard, syncUsage } from '../telemetry';
import { RequestError } from '../provider';
import { Conversations } from '../conversations';
import { voicePreferenceSchema, patternSchema } from '../../shared/quality';
import { storeLearnedPreferences, storePatterns, readQuality } from '../quality';

const reportSchema = z
  .object({
    summary: z.string().min(1).max(12000),
    observations: z
      .array(
        z
          .object({
            source: z.string().min(1),
            quote: z.string().min(1).max(2000),
            comment: z.string().min(1).max(3000)
          })
          .strict()
      )
      .max(50)
  })
  .strict();
const turnSchema = z
  .object({
    speech: z.string().max(6000),
    action: z.string().min(1).max(6000),
    uncertainty: z.string().max(3000)
  })
  .strict();
const draftSchema = z
  .object({ prose: z.string().min(1).max(50000), assumptions: z.array(z.string().min(1).max(2000)).max(30) })
  .strict();

export function parseCreativeResult(operation: Run['creative'], raw: string, payload: object) {
  const value = JSON.parse(
    raw
      .trim()
      .replace(/^```(?:json)?\s*/, '')
      .replace(/\s*```$/, '')
  );
  if (operation!.input.operation === 'learn-edits') {
    const result = z.object({ preferences: z.array(voicePreferenceSchema.omit({ id: true, state: true, runId: true })).max(40) }).strict().parse(value);
    return { content: result.preferences.map(p => `- ${p.statement}`).join('\n') || '现有编辑证据不足以形成偏好。', preferences: result.preferences };
  }
  if (operation!.input.operation === 'patterns') {
    const result = z.object({ summary: z.string().min(1), patterns: z.array(patternSchema.omit({ id: true, state: true, origin: true, runId: true })).max(100) }).strict().parse(value);
    const allowed = (payload as { documents: { path: string; hash: string; text: string }[] }).documents;
    if (result.patterns.some(p => p.sources.some(s => !allowed.some(d => d.path === s.path && d.hash === s.hash && Array.from(d.text).slice(s.start, s.end).join('') === s.quote)))) throw new Error('场景引用超出当前比较范围');
    return { content: result.summary, patterns: result.patterns };
  }
  if (operation!.input.operation === 'compare-feedback') {
    const result = z.object({ conclusions: z.array(z.object({ observation: z.string().min(1), observationIds: z.array(z.string()).min(1), alternatives: z.array(z.string()) }).strict()).max(30), nextExperiment: z.string() }).strict().parse(value);
    const observations = (payload as { observations: { id: string; state: string; excluded: string }[] }).observations;
    if (result.conclusions.some(c => c.observationIds.some(id => !observations.some(o => o.id === id && o.state === 'active' && !o.excluded)))) throw new Error('结论引用了无效反馈');
    return { content: result.conclusions.map(c => `${c.observation}\n${c.alternatives.join('；')}`).join('\n\n') + `\n\n下一轮：${result.nextExperiment}` };
  }
  if (operation!.input.operation === 'first-read') {
    const result = reportSchema.parse(value);
    const documents = (payload as { documents: { source: string; text: string }[] }).documents;
    if (
      result.observations.some(
        (observation) =>
          !documents.some(
            (document) => document.source === observation.source && document.text.includes(observation.quote)
          )
      )
    )
      throw new Error('初读报告引用了阅读范围外的内容，结果保留供检查');
    return {
      content: `${result.summary}\n\n${result.observations.map((observation) => `- ${observation.source}「${observation.quote}」\n  ${observation.comment}`).join('\n')}`
    };
  }
  if (operation!.input.operation === 'rehearse') {
    const result = turnSchema.parse(value);
    return { content: `行动：${result.action}\n\n对白：${result.speech}\n\n尚不确定：${result.uncertainty}`, turn: { speech: result.speech, action: result.action } };
  }
  const result = draftSchema.parse(value);
  return {
    content:
      result.prose +
      (result.assumptions.length
        ? `\n\n待选假设：\n${result.assumptions.map((value) => `- ${value}`).join('\n')}`
        : ''),
    prose: result.prose
  };
}

type Host = Pick<AgentRunner, 'store' | 'skillRoot' | 'caller' | 'save' | 'emit' | 'activity' | 'event'>;
export async function driveCreativeWorkflow(
  host: Host,
  run: Run,
  project: ProjectState,
  profile: SecretProfile,
  signal: AbortSignal
) {
  const task = run.creative!;
  const compiled = compileCreative(host.store, host.skillRoot, task.input, task.branchId);
  const { result: _result, ...saved } = task;
  if (fingerprint(saved) !== fingerprint(compiled.binding))
    throw new Error('创作任务的资料或范围已改变，请建立新任务');
  const prior = attempts(host.store, run.id).findLast(
    (attempt) => attempt.purpose === `creative:${task.input.operation}` && attempt.status === 'complete'
  );
  if (
    !prior &&
    attempts(host.store, run.id).some(
      (attempt) => attempt.status === 'unknown' || attempt.status === 'dispatching'
    )
  )
    throw new RequestError('已有请求结果未知，请先核对原请求，未自动重发', true);
  const messages: Run['messages'] = [{ role: 'user', content: JSON.stringify(compiled.modelPayload) }];
  syncUsage(host.store, run);
  setRunStatus(run, 'running');
  run.error = undefined;
  host.save(run);
  let raw: string;
  if (prior?.responseRef) {
    const receipt = JSON.parse(host.store.object(prior.responseRef).toString('utf8'));
    if (receipt.result.stop !== 'complete' || receipt.result.calls.length)
      throw new Error('已保存的创作结果不完整，请创建新任务');
    raw = receipt.result.text;
  } else {
    if (run.rounds >= project.config.maxRounds) throw new Error('已达到本任务请求次数上限');
    if ('protocolId' in task.input && task.input.protocolId) {
      const protocol = readQuality(host.store).protocols.find(p => p.id === ('protocolId' in task.input ? task.input.protocolId : ''))!;
      const used = [...host.store.db.allRuns()].filter(r => r.creative && 'protocolId' in r.creative.input && r.creative.input.protocolId === protocol.id).reduce((total, r) => total + attempts(host.store, r.id).filter(a => a.status !== 'not_sent').length, 0);
      if (used >= protocol.maxCalls) throw new Error('创作实验调用预算已用完');
    }
    requestGuard(profile, compiled.system, messages, [], run, project.config.stageBudget, 0);
    run.rounds++;
    host.save(run);
    const result = await callModel(
      host.store,
      run,
      `creative:${task.input.operation}`,
      host.caller,
      profile,
      compiled.system,
      messages,
      [],
      signal,
      undefined,
      { onActivity: (phase) => host.activity(run, phase) }
    );
    recordUsage(host.store, run, result.usage, {
      phase: `creative:${task.input.operation}`,
      profileId: profile.id,
      profileVersion: profile.version,
      usage: result.usage
    });
    if (signal.aborted) throw new RequestError('任务已停止，已收到结果保留于请求回执，未继续应用', true);
    run.responseText = result.text;
    host.save(run);
    if (result.stop !== 'complete' || result.calls.length)
      throw new Error('创作结果不完整或包含未授权工具，未应用');
    raw = result.text;
  }
  if (signal.aborted) throw new RequestError('任务已停止，未继续应用结果', false);
  const latest = compileCreative(host.store, host.skillRoot, task.input, task.branchId);
  if (fingerprint(compiled.binding) !== fingerprint(latest.binding))
    throw new Error('结果返回时基础资料已改变，旧结果未应用');
  const parsed = parseCreativeResult(task, raw, compiled.modelPayload);
  task.result = { content: parsed.content, hash: hash(parsed.content), createdAt: now(), synthetic: true };
  if ('turn' in parsed) task.result.turn = parsed.turn;
  const title = creativeOperations.find((value) => value.id === task.input.operation)!.title;
  if (['explore', 'rehearse', 'voice-pilot'].includes(task.input.operation)) {
    const records = new Conversations(host.store);
    const conversation =
      records.all('conversations').find((value) => value.id === `creative-${run.id}`) ??
      records.save('conversations', {
        id: `creative-${run.id}`,
        title,
        online: false,
        archived: false,
        createdAt: now(),
        updatedAt: now()
      });
    const messageId = `creative-${run.id}`;
    records.save('conversation_messages', {
      id: messageId,
      conversationId: conversation.id,
      turnId: '',
      role: 'assistant',
      content: parsed.content,
      createdAt: now(),
      status: 'complete',
      citations: []
    });
    const existing = records.all('draft_artifacts').find((value) => value.messageId === messageId);
    task.result.draftId =
      existing?.id ??
      records.saveDraft({
        title,
        content: parsed.prose ?? parsed.content,
        conversationId: conversation.id,
        messageId
      }).id;
  }
  run.responseText = `${title} · ${task.input.operation === 'first-read' ? '模型模拟，不计入真实读者数据' : '未采纳草稿'}\n\n${parsed.content}`;
  run.messages = messages;
  run.issues = [];
  run.changes = [];
  run.facts = [];
  host.store.db.transaction(() => {
    if ('preferences' in parsed) storeLearnedPreferences(host.store, run.id, parsed.preferences);
    if ('patterns' in parsed) storePatterns(host.store, run.id, parsed.patterns);
    setRunStatus(run, 'awaiting_review');
    host.store.db.saveRun(run);
    setRunStatus(run, 'complete');
    host.store.db.saveRun(run);
  });
  host.event(run, 'creative-complete', '创作工具结果已保存，正式作品版本保持原值');
  host.save(run);
}
