import type { z } from 'zod';
import type { SecretProfile, AppEvent } from '../../shared/types';
import {
  labStale,
  labFailure,
  type LabGenerate,
  type LabRequest,
  type LabVersion,
  type labCreateSchema,
  type labEditSchema,
  type labSelectSchema,
  type labUpdateSchema
} from '../../shared/story-lab';
import { invokeModel, RequestError } from '../provider';
import { callModel, attempts } from '../runtime/model-gateway';
import { fingerprint } from '../runtime/canonical';
import { errorPayload } from '../../shared/errors';
import { LabStore } from './store';
import { buildLabContext, labProfile } from './context';

export class StoryLabService {
  readonly store: LabStore;
  private active = new Map<
    string,
    { requestId: string; controller: AbortController; promise: Promise<void> }
  >();
  private draining = false;
  constructor(
    root: string,
    readonly skillRoot: string,
    private readonly profiles: () => SecretProfile[],
    private readonly emit: (event: AppEvent) => void,
    private readonly caller = invokeModel
  ) {
    this.store = new LabStore(root);
  }
  private profile(sessionId: string) {
    const session = this.store.session(sessionId),
      profile = this.profiles().find(
        (p) => p.id === session.profileId && p.enabled && p.protocol !== 'images'
      );
    if (!profile?.apiKey) throw new Error('请在模型设置中配置可用连接，再选择实验室模型');
    return labProfile(profile, session.outputLimit);
  }
  create(input: z.infer<typeof labCreateSchema>) {
    const existing = this.store.get('sessions', input.id);
    if (existing) {
      if (fingerprint(existing.requirements) !== fingerprint(input.requirements))
        throw new Error('同一实验编号对应了不同要求');
      return this.store.detail(existing.id);
    }
    const at = new Date().toISOString();
    this.store.save('sessions', {
      ...input,
      title: input.requirements.idea.slice(0, 36),
      currentVersionId: null,
      currentProseId: null,
      pins: [],
      revision: 0,
      createdAt: at,
      updatedAt: at
    });
    return this.store.detail(input.id);
  }
  update(input: z.infer<typeof labUpdateSchema>) {
    const session = this.store.session(input.sessionId);
    this.store.checkRevision(session, input.expectedRevision);
    Object.assign(session, { profileId: input.profileId, outputLimit: input.outputLimit, pins: input.pins });
    this.store.update(session);
    return this.store.detail(session.id);
  }
  edit(input: z.infer<typeof labEditSchema>) {
    const session = this.store.session(input.sessionId),
      base = this.store.version(session.id, input.baseVersionId);
    this.store.checkRevision(session, input.expectedRevision);
    const version: LabVersion = {
      ...base,
      id: crypto.randomUUID(),
      title: input.title || '手动编辑',
      content: input.content,
      baseVersionId: base.id,
      requestId: null,
      source: 'edit',
      partial: false,
      createdAt: new Date().toISOString()
    };
    this.store.journal.db.transaction(() => {
      this.store.save('versions', version);
      // An edit is a new saved candidate; selecting it is always an explicit, separate action.
      this.store.update(session);
    });
    return this.store.detail(session.id);
  }
  select(input: z.infer<typeof labSelectSchema>) {
    const session = this.store.session(input.sessionId),
      version = this.store.version(session.id, input.versionId);
    this.store.checkRevision(session, input.expectedRevision);
    const request = version.requestId ? this.store.get('requests', version.requestId) : undefined;
    const changedPlan =
      version.kind === 'prose' && request && request.input.baseVersionId !== session.currentVersionId;
    if ((labStale(session, version) || changedPlan) && !input.reviewedStale)
      throw new Error('候选基于较早版本，请查看差异后明确采用；不会覆盖较新内容。');
    if (version.kind === 'discussion')
      throw new Error('讨论回答不能直接作为整份方案，请使用局部修改或保存为方案候选');
    if (version.kind === 'prose') session.currentProseId = version.id;
    else session.currentVersionId = version.id;
    this.store.update(session);
    return this.store.detail(session.id);
  }
  preview(input: LabGenerate) {
    return buildLabContext(this.store, this.skillRoot, input, this.profile(input.sessionId));
  }
  start(input: LabGenerate): LabRequest {
    if (this.draining) throw new Error('实验室正在关闭');
    const existing = this.store.get('requests', input.requestId),
      inputHash = fingerprint(input);
    if (existing) {
      if (existing.inputHash !== inputHash || existing.sessionId !== input.sessionId)
        throw new Error('同一请求编号不能用于不同操作');
      return existing; // Includes interrupted and unknown requests: never replay a paid request.
    }
    if (this.active.has(input.sessionId))
      throw new Error('本实验正在生成，请等待或停止；其他实验可独立运行。');
    const prior = this.store.all('requests', input.sessionId);
    if (
      prior.some((r) => r.status === 'unknown' || (r.status === 'cancelled' && r.usage.cost === null)) &&
      !input.acknowledgeUnknown
    )
      throw new Error('此前存在结果或费用未知的请求；继续会产生新的请求，请先确认。');
    const session = this.store.session(input.sessionId),
      profile = this.profile(session.id);
    const context = buildLabContext(this.store, this.skillRoot, input, profile);
    const at = new Date().toISOString();
    const request: LabRequest = {
      id: input.requestId,
      sessionId: session.id,
      action: input.action,
      input,
      inputHash,
      status: 'running',
      context,
      model: {
        profileId: profile.id,
        name: profile.name,
        model: profile.model,
        protocol: profile.protocol,
        version: profile.version,
        outputLimit: profile.outputLimit,
        reasoningEffort: profile.reasoningEffort ?? null,
        transport: profile.protocol === 'responses' ? profile.responsesTransport ?? 'http' : 'http',
        timeoutSeconds: profile.timeoutSeconds
      },
      response: '',
      versionId: null,
      error: '',
      sequence: 0,
      usage: { input: null, output: null, cost: null, currency: profile.currency },
      attempts: 0,
      baseRevision: session.revision,
      baseProseVersionId: session.currentProseId,
      startedAt: at
    };
    this.store.journal.db.transaction(() => {
      this.store.save('requests', request);
      this.store.save('messages', {
        id: crypto.randomUUID(),
        sessionId: session.id,
        requestId: request.id,
        role: 'user',
        content: input.instruction || session.requirements.idea,
        action: input.action,
        versionId: null,
        createdAt: at
      });
    });
    const controller = new AbortController();
    // Publish active identity before invoking even a synchronous test provider.
    const promise = Promise.resolve()
      .then(() => this.run(request, profile, controller.signal))
      .finally(() => this.active.delete(session.id));
    this.active.set(session.id, { requestId: request.id, controller, promise });
    void promise.catch(() => {}); // Errors are persisted and surfaced in this request, not the formal workspace.
    return request;
  }
  private event(request: LabRequest, offset: number, text?: string) {
    request.sequence++;
    this.store.save('requests', request);
    this.emit({
      type: 'story-lab',
      workspace: 'story-lab',
      sessionId: request.sessionId,
      requestId: request.id,
      sequence: request.sequence,
      text,
      data: { status: request.status, offset }
    });
  }
  private async run(request: LabRequest, profile: SecretProfile, signal: AbortSignal) {
    let pending = '',
      checkpointAt = 0;
    try {
      const owner = {
        id: request.id,
        workspace: 'story-lab' as const,
        sessionId: request.sessionId,
        reasoningEfforts: { [profile.id]: profile.reasoningEffort ?? null },
        usage: { input: 0, output: 0, cost: 0, currency: profile.currency }
      };
      const result = await callModel(
        this.store.journal,
        owner,
        `story-lab:${request.action}`,
        this.caller,
        profile,
        request.context.system,
        [{ role: 'user', content: request.context.user }],
        [],
        signal,
        (delta) => {
          if (signal.aborted) return;
          request.response += delta;
          pending += delta;
          if (Date.now() - checkpointAt >= 120) {
            this.event(request, request.response.length - pending.length, pending);
            pending = '';
            checkpointAt = Date.now();
          }
        },
        {
          onActivity: (phase) => {
            if (phase !== 'waiting' || request.attempts) return;
            request.attempts = attempts(this.store.journal, request.id).length;
            this.event(request, request.response.length);
          }
        }
      );
      request.response = result.text;
      request.usage = result.usage;
      request.status = signal.aborted
        ? 'cancelled'
        : result.stop === 'length'
          ? 'length'
          : result.stop === 'filtered'
            ? 'filtered'
            : 'complete';
      if (result.calls.length)
        request.error = '模型返回了工具请求；实验室未执行工具，也未追加请求。原始文字已保留。';
    } catch (error) {
      if (
        error instanceof RequestError &&
        error.partial?.text &&
        error.partial.text.length > request.response.length
      )
        request.response = error.partial.text;
      const rows = attempts(this.store.journal, request.id);
      request.status = signal.aborted
        ? 'cancelled'
        : rows.some((r) => r.status === 'unknown' || r.status === 'dispatching')
          ? 'unknown'
          : 'not_sent';
      if (!rows.length || rows.every((r) => r.status === 'not_sent'))
        request.usage = { input: 0, output: 0, cost: 0, currency: profile.currency };
      request.error = errorPayload(error, [profile.apiKey, ...Object.values(profile.headers ?? {})]).message;
      request.failure = labFailure(error instanceof RequestError ? error.diagnostic : undefined);
    } finally {
      request.attempts = attempts(this.store.journal, request.id).filter(
        (r) => r.status !== 'not_sent'
      ).length;
      request.endedAt = new Date().toISOString();
      this.store.finish(request);
      this.event(request, request.response.length);
    }
  }
  cancel(sessionId: string, requestId: string) {
    const active = this.active.get(sessionId);
    if (active?.requestId === requestId) active.controller.abort();
    return true;
  }
  async settled(sessionId: string) {
    await this.active.get(sessionId)?.promise;
  }
  async close() {
    this.draining = true;
    for (const active of this.active.values()) active.controller.abort();
    await Promise.allSettled([...this.active.values()].map((a) => a.promise));
    this.store.close();
  }
}
