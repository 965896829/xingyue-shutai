/** Local Playwright fixture: real Service/storage, deterministic model, disposable projects. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { Service } from '../../src/core/service';
import { profileSchema, factSchema, type Command, type ModelResult } from '../../src/shared/types';
import { paths, stageOutputs, activeBatch, batchPath, rhythmPath, taskPath, detailPath, prosePath, qualityPath, hash } from '../../src/core/domain';
import { encodeFacts } from '../../src/core/memory-records';
import { proposalHash } from '../../src/core/storage';
import { fakeResult } from './refactor';
import { fixture } from './workflow';
import { fixtureAuditEvidence, fixtureCoverage } from './chapter-coverage';
import { normalize, RequestError } from '../../src/core/provider';
import { nativeResponse, nativeText, nativeCall } from './native-search';
import { AssistantSettings } from '../../src/core/assistant-settings';
import { planKinds } from '../../src/shared/creation';
import { titleSource } from '../../src/core/title-naming';
import { chapterTableFixture, volumeTableFixture, tableEdgeFixture } from './readable-tables';
import { createPlaybackFixture } from './streaming-playback';
import { createManuscriptFixture } from './manuscript-studio';
import { createVisualWorkbenchFixture } from './workbench-visual';
import { createChapterRetryFixture } from './chapter-retry';
import { concisePlanningReportSchema } from '../../src/shared/tags';
import { mutateQuality, readQuality } from '../../src/core/quality';
import { FileStore } from '../../src/core/storage';
import { writingStyleReportFixture } from './writing-style';

const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-tag-ui-'));
const clients = new Set<import('node:http').ServerResponse>();
// Reusable opening-flow scenarios, isolated from installed data and real models.
const creationScenario = process.env.CREATION_UI_SCENARIO;
const failedOnce = new Set<string>();
let advanceChatProgress: (() => void) | undefined;
const waitForChatProgress = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  const finish = () => { signal.removeEventListener('abort', abort); advanceChatProgress = undefined; resolve(); };
  const abort = () => { signal.removeEventListener('abort', abort); advanceChatProgress = undefined; reject(new Error('已停止')); };
  if (signal.aborted) { abort(); return; }
  advanceChatProgress = finish;
  signal.addEventListener('abort', abort, { once: true });
});
let modelRequests = 0;
const localRequests: Record<string, number> = {};
const service: Service = new Service(
  path.resolve('resources/skill'),
  (event) => {
    for (const res of clients) res.write(`data: ${JSON.stringify(event)}\n\n`);
  },
  async (_profile, _system, messages, tools, _signal, delta, options): Promise<ModelResult> => {
    modelRequests++;
    if (creationScenario === 'writing_style') {
      await waitForChatProgress(_signal);
      return fakeResult(JSON.stringify(writingStyleReportFixture));
    }
    if (creationScenario === 'chat_progress') {
      await waitForChatProgress(_signal);
      options?.onActivity?.('thinking');
      await waitForChatProgress(_signal);
      const hasRead = messages.some(message => message.role === 'tool');
      const text = hasRead ? '资料与规则已经核对。开场可以从维修员发现停电异常写起，让人物的行动带出疑问。'
        : '我会先读取作品资料，核对当前创作规则，再整理故事开场的建议。';
      delta?.(text);
      await waitForChatProgress(_signal);
      return hasRead ? fakeResult(text) : { ...fakeResult(text), stop: 'tools', calls: [
        { id: 'progress-read-book', name: 'read_book', arguments: JSON.stringify({ path: paths.style, reason: '核对作品风格', lines: 2 }) },
        { id: 'progress-read-rule', name: 'read_rule', arguments: JSON.stringify({ name: 'workflow', lines: 2 }) }
      ] };
    }
    if (process.env.SCALE_UI_DELAY === '1') await new Promise<void>((resolve, reject) => {
      if (_signal.aborted) { reject(_signal.reason); return; }
      const abort = () => { clearTimeout(timer); reject(_signal.reason); };
      const timer = setTimeout(() => { _signal.removeEventListener('abort', abort); resolve(); }, 30000);
      _signal.addEventListener('abort', abort, { once: true });
    });
    if (creationScenario === 'task_retry') {
      await new Promise(resolve => setTimeout(resolve, 800));
      throw new RequestError('离线验收在新正文请求入口暂停，未连接真实模型。', false);
    }
    if (['readable_tables', 'streaming_playback', 'manuscript_studio', 'workbench_visual'].includes(creationScenario ?? '')) throw new Error('显示验收不允许调用模型');
    if (process.env.NATIVE_SEARCH_UI === '1') {
      if (!options?.webSearch) return fakeResult('本轮没有联网，沿用当前已确认资料。');
      options.onWebSearch?.({ id: nativeCall.id, status: 'searching', sources: [] });
      await new Promise(resolve => setTimeout(resolve, 100));
      delta?.(nativeText);
      return normalize(_profile, nativeResponse);
    }
    const run = service.store!.db.runs().find((r) => r.status === 'running')!;
    if (run?.creative) {
      const input = JSON.parse(messages[0].content);
      if (run.creative.input.operation === 'learn-edits') return fakeResult(JSON.stringify({ preferences: input.evidence.filter((e: any) => e.domain === 'expression').map((e: any) => ({ statement: '在对话中用具体动作表现犹豫', scope: e.scope, evidenceIds: [e.id], alternatives: ['此处的停顿可能仅适用于当前场景'], exceptions: ['人物直接坦白时'] })) }));
      if (run.creative.input.operation === 'patterns') return fakeResult(JSON.stringify({ summary: '当前场景以试探回应解决信息不对称。', patterns: input.documents.map((d: any) => ({ chapter: Number(d.source.split('-')[1]), scene: '门前试探', sources: [{ path: d.path, hash: d.hash, start: 0, end: 12, quote: Array.from(d.text).slice(0, 12).join('') }], conflict: '门后信息未知', strategy: '轻声询问', response: '等待动静', solution: '获得回应', change: '从猜测转为观察', reward: '疑问推进', protectedRepetition: 'none' })) }));
      if (run.creative.input.operation === 'compare-feedback') return fakeResult(JSON.stringify({ conclusions: [], nextExperiment: '继续收集独立读者反馈。' }));
      return fakeResult(JSON.stringify(run.creative.input.operation === 'first-read'
        ? { summary: '模拟首读：阿宁推门后的情形尚未揭晓。', observations: [{ source: input.documents[0].source, quote: '阿宁', comment: '已建立观察人物。' }] }
        : run.creative.input.operation === 'rehearse' ? { speech: '谁在外面？', action: '阿宁停在门旁，听了一会儿。', uncertainty: '尚不知道来人的身份。' }
        : { prose: creationScenario === 'creative_v7_chapter' ? fixture(service.store!.db.project(), prosePath(1), service) : '阿宁蹲下来，听见墙里传来三下敲击。她把工具箱推到身后，轻轻叩了回去。', assumptions: ['墙后有人回应'] }));
    }
    if (creationScenario === 'creative_v7_chapter' && run.pipeline) {
      const input = JSON.parse(messages[0].content), project = service.store!.db.project();
      if (input.items) {
        const memory = { decisions: input.items.map((item: any) => ({ id: item.id, verdict: 'supported', reason: '离线夹具核对。', evidence: fixtureAuditEvidence(item, input.sources) })) };
        const plans = { decisions: (input.plans ?? []).map((plan: any) => ({ path: plan.path, verdict: 'consistent', reason: '离线计划与本章原文一致。', planQuote: input.sources.find((s: any) => s.path === plan.path).content.slice(0, 30), proseQuote: input.sources.find((s: any) => s.path === input.prose.path).content.slice(0, 30) })) };
        return fakeResult(JSON.stringify(input.plans ? { memory, plans } : memory));
      }
      const memory = run.pipeline.phase === 'memory';
      return { ...fakeResult(''), stop: 'tools', calls: [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes: (memory ? stageOutputs('S11', project) : [qualityPath(1)]).map(file => service.change(file, fixture(project, file, service))), ...(memory ? { facts: [], complete: true, coverage: fixtureCoverage(service, run) } : {}) }) }] };
    }
    if (!run && creationScenario === 'context_meter') {
      await new Promise(resolve => setTimeout(resolve, 300));
      delta?.('可以直接讨论或提出修改意见。原设定保留，生成内容满意后再保存。');
      return { ...fakeResult('可以直接讨论或提出修改意见。原设定保留，生成内容满意后再保存。'),
        usage: { input: 12345, output: 150, cachedInput: 11000, cost: 0, currency: 'USD' } };
    }
    if (run.naming) {
      const t = run.naming, name = tools[0].name;
      if (creationScenario === 'title_error' && !failedOnce.has(run.id)) {
        failedOnce.add(run.id);
        throw new RequestError('模型返回 HTTP 502。命名请求暂时失败。', false);
      }
      const source = titleSource(service.store!, t.sourceRunId);
      const iteration = service.store!.db.runs().filter(candidate => candidate.naming?.planHash === t.planHash).length;
      const batch = { planHash: t.planHash, candidates: t.manualTitle ? [{ id: 'manual', title: t.manualTitle,
        angle: '作者命名', readerPromise: '维修、协作与家园建设', supportingClaimIds: [source.plan.statements[0].id], payoffStage: 'ongoing', riskNotes: [] }]
        : ['供水线上的维修师', '从一口清水开始', '水泵旁的家园', '修好水泵之后', '废城里的一口清水', '末世供水站'].map((title, i) => ({ id: 'name-' + i, title: iteration > 1 ? `${title}·${iteration}` : title,
          angle: ['职业与行动', '成长起点', '家园建设', '行动结果', '资源冲突', '环境与职业'][i], readerPromise: '用维修技术恢复供水，逐步建设家园',
          supportingClaimIds: [source.plan.statements[0].id], payoffStage: 'ongoing', riskNotes: ['家园成长需要在后续持续展示'] })),
        recommendedIds: t.manualTitle ? ['manual'] : ['name-0', 'name-1', 'name-2'] };
      if (t.regenerate) {
        batch.candidates = t.regenerate.original.candidates.map(c => c.id === t.regenerate!.candidateId ? { ...c, title: `修水师的新约定·${t.history.length}` } : c);
        batch.recommendedIds = t.regenerate.original.recommendedIds;
      }
      return { ...fakeResult(''), stop: 'tools', calls: [{ id: crypto.randomUUID(), name, arguments: JSON.stringify(name === 'submit_title_candidates' ? batch : {
        decisions: t.batch!.candidates.map((c, index) => ({ candidateId: c.id,
          verdict: creationScenario === 'title_partial' && index === 1 ? 'revise' : 'keep',
          reason: creationScenario === 'title_partial' && index === 1 ? '该候选的承诺需要进一步明确，可选择其他候选或单独修改' : '对应已确认方案，没有新增能力或关系' })),
        ...(t.editorialVersion === 2 ? { recommendedIds: t.batch!.recommendedIds } : {})
      }) }] };
    }
    if (_system.includes('你独立检查')) {
      const input = JSON.parse(messages[0].content);
      return fakeResult(JSON.stringify({ decisions: input.items.map((item: any) => {
        const source = input.sources.find((source: any) => source.path === (item.path ?? item.fact.evidence[0].path));
        return { id: item.id, verdict: 'supported', reason: '模拟审阅：与当前约束和上游计划一致', evidence: [{ path: source.path, quote: source.content.slice(0, 60) }] };
      }) }));
    }
    if (run.memoryRepair) {
      const input = JSON.parse(messages[0].content);
      return fakeResult(JSON.stringify({ content: input.file.content + '\n\n后续安排：第三章起阿宁改用左手持盾，避开右手发力。',
        reason: '核对第三章起的行动安排，前两章保留。', records: [], withdrawn: [] }));
    }
    if (!run.planning) {
      if (messages.at(-1)?.role === 'tool')
        return { text: '故事方案已整理，请确认方向。', calls: [], native: {}, usage: { input: 10, output: 10, cost: 0, currency: 'USD' }, stop: 'complete' };
      const project = service.store!.db.project();
      if (run.continuity?.mode === 'forward') return { ...fakeResult(''), stop: 'tools', calls: [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes: [{
        path: paths.roles, baseHash: service.store!.db.document(paths.roles)!.hash,
        content: service.store!.readAccepted(paths.roles).content + '\n\n作者后续约束：' + run.request
      }] }) }] };
      return { text: '', calls: [{ id: crypto.randomUUID(), name: 'propose_changes', arguments: JSON.stringify({ changes: stageOutputs(run.stage, project).map(file => ({ path: file, content: fixture(project, file, service), baseHash: service.store!.db.document(file)?.hash ?? null })) }) }], native: {}, usage: { input: 10, output: 10, cost: 0, currency: 'USD' }, stop: 'tools' };
    }
    const t = run.planning;
    const name = tools[0].name;
    if (name === 'submit_creation_contract' && ['connection_error', 'unknown_request'].includes(creationScenario ?? '') && !failedOnce.has(run.id)) {
      failedOnce.add(run.id);
      throw new RequestError('模型返回 HTTP 502。模型服务或中转暂时异常，已保留当前进度。', creationScenario === 'unknown_request');
    }
    let value: unknown;
    if (name === 'submit_planning_report')
      value = {
        positioning: '围绕维修、协作与公共供水，比较三种持续冲突。',
        diagnosis: [],
        assumptions: [
          { id: 'limit', text: '储物空间只保存物品，不能复制或制造物品。', critical: true, directionIds: [] }
        ],
        directions: ['供水社区', '流动维修车队', '跨城技术协作'].map((title, i) => {
          const regeneration = t.regenerate;
          const frozen = regeneration && (regeneration.keepDirectionIds === undefined
            ? 'd' + i !== regeneration.directionId : regeneration.keepDirectionIds.includes('d' + i));
          if (frozen) return structuredClone(regeneration.original.directions.find(direction => direction.id === 'd' + i)!);
          const revision = regeneration ? `第${t.history.filter(item => item.kind === 'reroll_request').length}轮新构思` : '';
          return {
          id: 'd' + i,
          ...(t.directionFormatVersion === 2 ? { worldSuggestions: [{ moduleId: 'technology-profession', state: 'enabled', reason: '维修工作需要明确职业能力与流程', assumptionIds: [] }] } : {}),
          title: title + revision,
          logline: '维修师用有限工具应对资源与合作难题。',
          storyEngine: ['公共设备维护与分配冲突', '沿途故障与不同社区的交换', '跨区域标准与互信建设'][i] + revision,
          differenceFromOtherDirections: ['固定社区治理', '移动路线与短期协作', '跨城组织与长期博弈'][i],
          openingDecision: '修复水泵还是先救被困的人？',
          firstVolumeChange: '建立一条可持续供水的协作链。',
          longRunRisk: '避免反复故障成为机械任务。',
          intentChanges: creationScenario === 'concise_directions' && i === 1 ? ['原先驻守一个社区，本案改为沿供水线流动维修。'] : [],
          tagCoverage: t.knowledge.options.map((o) => ({
            optionId: o.id,
            implementation: title + '中的有限能力与合作代价。',
            firstDemonstration: '开篇维修行动',
            risk: '保持能力边界。'
          }))
        }; }),
        recommendedDirectionId: 'd0',
        recommendationReasons: ['最接近作者的社区想法。'],
        marketClaims: [],
        unresolvedQuestions: []
      };
    else if (name === 'submit_planning_review') value = { issues:
      creationScenario === 'blocking_review' && t.phase === 'reviewing_contract' ? [{ code: 'ability_conflict', severity: 'major',
        jsonPointer: '/constraints/0/text', explanation: '工具来源与能力边界仍有冲突，需要先确定哪些物品可以制造。', suggestedFix: '补充能力边界后重新策划。' }]
      : creationScenario === 'connection_error' ? [
        { code: 'cooperation', severity: 'minor', jsonPointer: '', explanation: '协作代价可以继续细化。例如让居民对供水优先顺序持有不同意见，选择维护哪一片区域也会影响下一次协作。', suggestedFix: '后续设计章节时补充具体的利益分歧。' },
        { code: 'repair_cost', severity: 'minor', jsonPointer: '', explanation: '工具磨损与维修耗时可以在后续规划中表现。当前方向已经可行，这些细节能够进一步让维修行动体现取舍。', suggestedFix: '在单章设计中安排一次材料不足时的主动选择。' }
      ] : [] };
    else
      value = {
        directionId: t.selectedDirectionId,
        constraints: [
          {
            id: 'limited-tools',
            optionIds: t.knowledge.options.map((o) => o.id),
            text: '储物能力不复制物品；遵守作者禁区。',
            scope: { entityIds: [], fromChapter: null, toChapter: null },
            evidenceRef: t.selectedDirectionId
          }
        ],
        tagCoverage: t.knowledge.options.map(o => ({ optionId: o.id, implementation: '维修与协作推动故事。', firstDemonstration: '开篇修复供水。', risk: '避免重复维修任务。' })),
        openQuestions: [],
        ...(t.workflowVersion === 2 ? { plan: {
          statements: Object.keys(planKinds).map((kind, i) => ({ id: 'plan-' + kind, kind,
            text: ['维修师恢复供水，让居民逐步建起家园。', '缺水带来维修需求，恢复供水又带来人口与分配问题。', '主角是务实的维修师，主动组织协作。', '先修复水泵，让居民获得清水。', '把供水网络发展成稳定的聚居地。',
              '依靠技术与有限工具，不能复制物品或制造无限资源。', '发现故障、协作维修、恢复供水、处理新增的需求。', '从设备维修逐步转向人员协作、供给分配和防御。', '开篇以有限工具修好一台水泵。', '不新增系统或后宫，压力与建设回报并存。'][i],
            sourceRefs: [t.selectedDirectionId], optionIds: [], payoffStage: kind === 'long_term_goal' ? 'long_term' : kind === 'opening' ? 'opening' : 'ongoing' })),
          tagRoles: t.knowledge.options.map(o => ({ optionId: o.id, roles: ['action'], implementation: '在维修与协作中落实这一元素', claimIds: ['plan-fusion_causality'] }))
        } } : {}),
        premiseDocument: t.origin === 'new' ? fixture(service.store!.db.project(), paths.seed, service) : service.store!.readAccepted(paths.seed).content
      };
    if (name === 'submit_planning_report' && t.directionFormatVersion === 1) {
      const { diagnosis, marketClaims, unresolvedQuestions, ...report } = value as import('../../src/shared/tags').PlanningReport;
      value = concisePlanningReportSchema.parse({ ...report, directions: report.directions.map(({ tagCoverage, ...direction }) => direction) });
    }
    return {
      text: '',
      calls: [{ id: crypto.randomUUID(), name, arguments: JSON.stringify(value) }],
      native: {},
      usage: { input: 10, output: 10, cost: 0, currency: 'USD' },
      stop: 'tools'
    } satisfies ModelResult;
  }
);
service.profiles = [
  {
    ...profileSchema.parse({
      id: 'fixture',
      name: '界面验收模型（模拟）',
      model: 'fixture',
      protocol: 'chat',
      baseUrl: 'http://127.0.0.1:1',
      contextLimit: 1000000
    }),
    apiKey: 'test-only'
  }
];
const assistantSettings = new AssistantSettings(parent);
if (creationScenario === 'editor_preferences') {
  assistantSettings.saveRole('editor', '保留必要的长句，不改剧情。');
  assistantSettings.saveRole('tomato', '短句用于紧张交锋，日常可以舒缓。');
  assistantSettings.saveSearch({ enabled: false, maxResults: 7 });
  service.assistant.roles = assistantSettings.roles();
}
if (creationScenario === 'writing_style') {
  fs.mkdirSync(path.join(parent, 'request-journal'), { recursive: true });
  service.requestJournal = new FileStore(path.join(parent, 'request-journal'));
  await service.invoke('project.create', { parent, title: '风格选择验收', premise: '维修员阿宁在一次停电中发现异常。', config: { defaultProfileId: 'fixture', genre: '都市悬疑', expressionRules: { enabled: false } } });
}
if (creationScenario === 'chat_progress') {
  await service.invoke('project.create', { parent, title: '对话进度展示', premise: '维修员阿宁追查停电原因。', config: { defaultProfileId: 'fixture', expressionRules: { enabled: false } } });
  const run = service.makeRun('stage', '整理故事开场', 'fixture');
  run.responseText = '开场从维修员发现停电异常写起。可以继续讨论人物的下一步行动。';
  run.status = 'awaiting_review';
  service.store!.db.saveRun(run);
}
if (creationScenario === 'creative_v7_chapter') {
  await service.invoke('project.create', { parent, title: '探索草稿转章验收', premise: '阿宁调查停电原因。', config: { defaultProfileId: 'fixture', preview: { enabled: false } } });
  let p = service.store!.db.project();
  for (const stage of ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09'] as const) {
    service.store!.commit(stageOutputs(stage, p).map(file => service.change(file, fixture(p, file, service))), p);
    p = service.store!.db.project();
  }
  p.stage = 'S10'; service.store!.db.set('project', p);
}
if (creationScenario === 'creative_v7' || creationScenario === 'quality_v7') {
  await service.invoke('project.create', { parent, title: '独立创作工具验收', premise: '阿宁调查墙内的敲击声。', config: { defaultProfileId: 'fixture' } });
  const store = service.store!;
  store.commit([{ path: prosePath(1), content: '# 第一章\n\n阿宁推开门，屋里静得只剩时钟的声音。', baseHash: store.db.document(prosePath(1))?.hash ?? null }], store.db.project());
  const prose = store.readAccepted(prosePath(1));
  const fact = factSchema.parse({ id: 'fixture-door', subject: '阿宁', entityIds: ['aning'], predicate: '观察', value: '屋里只有时钟声', category: 'character', kind: 'belief', fromChapter: 1, revealedAt: 1, reviewStatus: 'accepted', knowledge: [{ who: 'aning', mode: 'seen', fromChapter: 1 }], evidence: [{ path: prosePath(1), hash: hash(prose.content), quote: '屋里静得只剩时钟的声音。' }] });
  store.commit([service.change(paths.roles, encodeFacts(store.readAccepted(paths.roles).content, [fact]))], store.db.project());
}
const playback = creationScenario === 'streaming_playback' ? await createPlaybackFixture(service, parent) : undefined;
if (creationScenario === 'quality_v7') {
  const store = service.store!, file = prosePath(1), after = store.readAccepted(file).content;
  const before = '# 第一章\n\n阿宁觉得屋里很安静，她心想也许没有人。';
  store.commit([service.change(file, before)], store.db.project());
  store.commit([service.change(file, after)], store.db.project());
  const span = (content: string) => ({ path: file, hash: hash(content), start: 0, end: Array.from(content).length, quote: content });
  mutateQuality(store, readQuality(store).revision, { kind: 'evidence', evidence: { before: span(before), after: span(after), scope: { kind: 'scene', target: '门前', sceneFunction: '对话' }, domain: 'expression', reason: '保留观察动作，删去重复心理说明', editor: 'author' } });
}
if (creationScenario === 'manuscript_studio') await createManuscriptFixture(service, parent, process.env.MANUSCRIPT_FIXTURE_PATH);
if (creationScenario === 'workbench_visual') await createVisualWorkbenchFixture(service, parent);
if (creationScenario === 'task_retry') await createChapterRetryFixture(service, parent, 'fixture');
if (creationScenario === 'readable_tables') {
  await service.invoke('project.create', { parent, title: '横向表格显示验收', premise: '仅用于本地界面验收的合成数据。', config: { defaultProfileId: 'fixture', expressionRules: { enabled: false } } });
  const store = service.store!, project = store.db.project();
  project.stage = 'S06'; project.revision++;
  const content = `${chapterTableFixture}\n\n${volumeTableFixture}\n\n${tableEdgeFixture}`;
  store.commit([{ path: paths.outline, baseHash: store.db.document(paths.outline)?.hash ?? null, content },
    { path: paths.volumes, baseHash: store.db.document(paths.volumes)?.hash ?? null, content: volumeTableFixture }], project);
  const run = service.makeRun('stage', '生成本批次章节总纲', 'fixture');
  run.changes = [{ path: paths.outline, baseHash: store.db.document(paths.outline)!.hash, content }];
  run.responseText = '章节总纲已生成，包含 30 章。可以直接查看内容并提出修改意见。';
  store.db.saveRun(run);
  const conversations = [service.snapshot().conversations![0], service.chat!.records.create('章节总纲 · 任务对话', false, run.id)];
  for (const conversation of conversations) {
    const at = new Date().toISOString(), turnId = `table-turn-${conversation.id}`, messageId = `table-message-${conversation.id}`;
    service.chat!.records.save('conversation_turns', { id: turnId, conversationId: conversation.id, messageId,
      profileId: 'fixture', profileVersion: 1, status: 'complete', createdAt: at, updatedAt: at, rules: [], citations: [], messages: [],
      usage: { input: 0, output: 0, cost: 0, currency: 'USD' }, calls: [], budgets: [], kind: 'discussion', request: '展示已生成内容' });
    service.chat!.records.save('conversation_messages', { id: messageId, conversationId: conversation.id, turnId, role: 'assistant',
      content, createdAt: at, status: 'complete', citations: [] });
  }
}
if (creationScenario === 'context_meter') {
  service.profiles[0].contextLimit = 128000;
  service.profiles.push({ ...structuredClone(service.profiles[0]), id: 'fixture-large', name: '大上下文模型（模拟）', model: 'fixture-large', contextLimit: 512000 });
  await service.invoke('project.create', { parent, title: '上下文与内容交互验收', premise: '事故调查员持有自己的死亡权。', config: { defaultProfileId: 'fixture', expressionRules: { enabled: false } } });
  const conversation = service.snapshot().conversations![0];
  for (let i = 0; i < 25; i++) {
    const at = new Date(Date.now() - 100000 + i).toISOString();
    service.chat!.records.save('conversation_turns', { id: `history-turn-${i}`, conversationId: conversation.id, messageId: `history-${i}`,
      profileId: 'fixture', profileVersion: 1, status: 'complete', createdAt: at, updatedAt: at, rules: [], citations: [], messages: [],
      usage: { input: 0, output: 0, cost: 0, currency: 'USD' }, calls: [], budgets: [], kind: 'discussion', request: '历史讨论' });
    service.chat!.records.save('conversation_messages', {
      id: `history-${i}`, conversationId: conversation.id, turnId: `history-turn-${i}`, role: i % 2 ? 'assistant' : 'user',
      content: '这是未采纳的讨论，原设定保持不变。'.repeat(30) + i, createdAt: at, status: 'complete', citations: []
    });
  }
}
if (process.env.NATIVE_SEARCH_UI === '1') {
  service.profiles[0].protocol = 'responses';
  service.profiles[0].hasKey = true;
  await service.invoke('project.create', { parent, title: '原生联网搜索验收', premise: '仅用于隔离界面验收', config: { defaultProfileId: 'fixture', expressionRules: { enabled: false } } });
}
if (process.env.TAG_UI_PROJECT) await service.open(process.env.TAG_UI_PROJECT);
if (process.env.CONTINUITY_UI === '1') {
  await service.invoke('project.create', { parent, title: '人物变化联动验收', premise: '只用于隔离界面验收',
    config: { defaultProfileId: 'fixture', expressionRules: { enabled: false }, chapterWords: 200, minWords: 180, maxWords: 250, targetWords: 1600, batchSize: 8, maxRounds: 40 } });
  const store = service.store!, project = store.db.project();
  project.chapter = 3; project.stage = 'S09'; project.chapters = { 1: 'complete', 2: 'complete' }; project.revision++;
  const files = [paths.roles, paths.world, paths.volumes, paths.outline, rhythmPath(activeBatch(project)), batchPath(activeBatch(project)), taskPath(3), detailPath(3), prosePath(1), prosePath(2)];
  store.commit(files.map(file => ({ path: file, baseHash: store.db.document(file)?.hash ?? null,
    content: fixture({ ...project, chapter: Number(file.match(/第(\d+)章/)?.[1] ?? project.chapter) }, file, service) })), project);
  const run = service.makeRun('revision', '阿宁从第三章起右手受伤，后续改用左手持盾。', 'fixture');
  run.continuity = { mode: 'forward', fromChapter: 3 };
  run.changes = [{ path: paths.roles, baseHash: store.db.document(paths.roles)!.hash, content: store.readAccepted(paths.roles).content + '\n\n第三章起，右手受伤，改用左手持盾。' }];
  run.status = 'awaiting_review'; store.db.saveRun(run);
  await service.invoke('run.accept', { id: run.id, proposalHash: proposalHash(run), warningReason: '界面验收用模拟数据' });
}
const server = await createServer({
  server: {
    host: '127.0.0.1',
    port: 5186,
    strictPort: true,
    watch: { ignored: ['**/.test-output/**', '**/release/**'] }
  },
  plugins: [
    {
      name: 'tag-ui-fixture',
      transformIndexHtml() {
        return [{ tag: 'script', injectTo: 'head-prepend' as const, children: `
          const fixtureListeners = new Set();
          let fixtureEvents;
          window.wenxu = {
            async invoke(command, args = {}) {
              const response = await fetch('/__test/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, args }) });
              const data = await response.json();
              return data.error ? { ok: false, error: { code: 'VALIDATION_ERROR', message: data.error, traceId: crypto.randomUUID(), actions: [] } } : { ok: true, result: data.value };
            },
            cancelWait() {},
            onEvent(listener) {
              fixtureListeners.add(listener);
              if (!fixtureEvents) { fixtureEvents = new EventSource('/__test/events'); fixtureEvents.onmessage = event => { for (const fn of fixtureListeners) fn(JSON.parse(event.data)); }; }
              return () => { fixtureListeners.delete(listener); if (!fixtureListeners.size) { fixtureEvents.close(); fixtureEvents = undefined; } };
            }
          };
        ` }];
      },
      configureServer(vite) {
        vite.middlewares.use('/__test/chat-progress', (_req, res) => {
          const pending = !!advanceChatProgress;
          advanceChatProgress?.();
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ pending }));
        });
        vite.middlewares.use('/__test/metrics', (_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ modelRequests, localRequests, playback: playback?.metrics() })); });
        vite.middlewares.use('/__test/playback', (req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(req.url?.includes('stop') ? playback?.stop() ?? {} : playback?.start() ?? {})); });
        vite.middlewares.use('/__test/events', (req, res) => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
          });
          res.write(': ready\n\n');
          clients.add(res);
          req.on('close', () => clients.delete(res));
        });
        vite.middlewares.use('/__test/rpc', async (req, res) => {
          try {
            let body = '';
            for await (const chunk of req) body += chunk;
            const { command, args = {} } = JSON.parse(body) as {
              command: Command;
              args: Record<string, unknown>;
            };
            localRequests[command] = (localRequests[command] ?? 0) + 1;
            if (creationScenario === 'task_retry' && command === 'proposal.confirm' && process.env.RETRY_UI_FAIL_ONCE === '1' && !failedOnce.has('proposal-confirm')) {
              failedOnce.add('proposal-confirm');
              throw new Error('模拟启动失败：请再次点击，验证错误提示与按钮位于同一张卡片。');
            }
            if (command === 'assistant.settings') {
              res.end(JSON.stringify({ value: assistantSettings.settings() })); return;
            }
            if (command === 'assistant.role.save' || command === 'assistant.role.reset' || command === 'assistant.role.rollback') {
              const key = args.id as import('../../src/shared/assistant').RoleId;
              if (command === 'assistant.role.save') assistantSettings.saveRole(key, String(args.text), '作者编辑', args.source as { id: string; version: string } | undefined);
              if (command === 'assistant.role.reset') assistantSettings.reset(key);
              if (command === 'assistant.role.rollback') assistantSettings.rollback(key, String(args.version));
              service.assistant.roles = assistantSettings.roles();
              res.end(JSON.stringify({ value: assistantSettings.settings() })); return;
            }
            if (command === 'search.settings.save') {
              const value = assistantSettings.saveSearch(args.search);
              service.assistant.search = value.search;
              res.end(JSON.stringify({ value })); return;
            }
            if (command === 'app.chooseDirectory') {
              res.end(JSON.stringify({ value: parent }));
              return;
            }
            if (command === 'project.create')
              args.config = { ...(args.config as object ?? {}), defaultProfileId: 'fixture', expressionRules: { enabled: false } };
            const value = await service.invoke(command, args);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ value }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: (e as Error).message }));
          }
        });
      }
    }
  ]
});
await server.listen();
console.log('Tag UI fixture: http://127.0.0.1:5186; disposable directory: ' + parent);
