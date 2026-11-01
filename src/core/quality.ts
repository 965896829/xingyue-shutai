import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { qualityStateSchema, qualityMutationSchema, sourceSpanSchema, voicePreferenceSchema, patternSchema, type QualityState, type VoiceScope } from '../shared/quality';
import type { FileStore } from './storage';
import { hash, id, now } from './domain';
import { fingerprint } from './runtime/canonical';
import { pendingSource } from './memory-source';

const stateKey = 'creative-quality-v1';
export const voicePath = '02_创作风格/声音偏好.md';
export function assertSpan(store: FileStore, source: z.infer<typeof sourceSpanSchema>, current = false) {
  sourceSpanSchema.parse(source);
  if (current && (store.db.document(source.path)?.hash !== source.hash || pendingSource(store.db.project(), source.path) || store.inspect(source.path)?.status !== 'accepted')) throw new Error('引用正文已变化，请重新选择');
  const known = store.db.document(source.path)?.hash === source.hash || store.db.history(source.path).some(row => row.hash === source.hash);
  if (!known) throw new Error('引用版本不属于该文稿');
  const content = store.read(source.path, source.hash).content;
  if (Array.from(content).slice(source.start, source.end).join('') !== source.quote) throw new Error('引用文字与原文位置不一致');
}
export function evidenceUsable(store: FileStore, evidence: QualityState['evidence'][number]) {
  if (evidence.state !== 'active') return false;
  try { assertSpan(store, evidence.before); assertSpan(store, evidence.after, true); return true; } catch { return false; }
}
export function readQuality(store: FileStore): QualityState {
  const state = qualityStateSchema.parse(store.db.get(stateKey) ?? { version: 1, revision: 0, evidence: [], preferences: [], patterns: [], experiments: [], presentations: [], observations: [] });
  for (const evidence of state.evidence) evidence.usable = evidenceUsable(store, evidence);
  for (const preference of state.preferences) {
    if (preference.evidenceIds.some(key => !state.evidence.some(e => e.id === key && evidenceUsable(store, e)))) preference.state = 'stale';
  }
  for (const pattern of state.patterns) {
    try { for (const source of pattern.sources) assertSpan(store, source, true); } catch { pattern.state = 'stale'; }
  }
  return state;
}
function save(store: FileStore, state: QualityState) {
  state.revision++;
  store.db.set(stateKey, qualityStateSchema.parse(state));
  return state;
}
export { save as saveQuality };
export function mutateQuality(store: FileStore, expectedRevision: number, raw: unknown) {
  const mutation = qualityMutationSchema.parse(raw);
  return store.db.transaction(() => {
    const state = readQuality(store);
    if (state.revision !== expectedRevision) throw new Error('记录已更新，请刷新后重试');
    if (mutation.kind === 'protocol') {
      if ([...state.protocols, ...state.experiments].some(p => p.family === mutation.protocol.family && p.stage !== mutation.protocol.stage)) throw new Error('同一创意族不能同时属于开发集和保留集');
      state.protocols.push({ ...mutation.protocol, id: id(), createdAt: now(), snapshotId: store.db.headRef()!.id, configurationHash: fingerprint(store.db.project().config) });
    } else if (mutation.kind === 'evidence') {
      const evidence = mutation.evidence;
      assertSpan(store, evidence.before); assertSpan(store, evidence.after, true);
      if (evidence.before.path !== evidence.after.path || evidence.before.hash === evidence.after.hash) throw new Error('请选择同一文稿的两个不同版本');
      if (evidence.scope.kind !== 'book' && !evidence.scope.target) throw new Error('请选择偏好的适用人物或场景');
      state.evidence.push({ ...evidence, id: id(), version: 1, state: 'active', createdAt: now() });
    } else if (mutation.kind === 'retract') {
      const evidence = state.evidence.find(e => e.id === mutation.id);
      if (!evidence) throw new Error('编辑证据不存在');
      evidence.state = 'retracted'; evidence.version++;
      for (const preference of state.preferences) if (preference.evidenceIds.includes(evidence.id)) preference.state = 'stale';
    } else if (mutation.kind === 'experiment') {
      if ([...state.protocols, ...state.experiments].some(e => e.family === mutation.experiment.family && e.stage !== mutation.experiment.stage)) throw new Error('同一创意族不能同时属于开发集和保留集');
      const protocol = mutation.experiment.protocolId ? state.protocols.find(p => p.id === mutation.experiment.protocolId) : undefined;
      if (mutation.experiment.protocolId && !protocol) throw new Error('预登记方案不存在');
      if (protocol && (['kind', 'stage', 'family', 'sceneFunction', 'audience', 'variedFactors', 'constraints', 'questions'] as const).some(key => fingerprint(protocol[key]) !== fingerprint(mutation.experiment[key]))) throw new Error('实验条件与预登记方案不一致');
      const candidates = mutation.candidates.map(candidate => {
        const run = candidate.runId ? store.db.run(candidate.runId) : undefined;
        if (run && !(run.creative?.result?.content.includes(candidate.text) || run.changes.some(c => c.content === candidate.text))) throw new Error('样稿与任务产物不一致');
        const provenance: Record<string, string> = run ? { profile: run.profileId, workflow: fingerprint(run.workflowBinding ?? {}), prompt: run.creative?.rulesHash ?? run.skillHash ?? '', context: run.creative?.packetHash ?? fingerprint(run.manifest ?? {}), usage: JSON.stringify(run.usage ?? {}) } : { origin: 'author_supplied' };
        return { ...candidate, id: id(), hash: hash(candidate.text), provenance };
      });
      if (new Set(candidates.map(c => c.hash)).size !== candidates.length) throw new Error('比较样稿不能相同');
      const preregistered = !!protocol && candidates.every(c => {
        if (!c.runId) return false;
        const run = store.db.run(c.runId), input = run.creative?.input;
        return run.createdAt >= protocol.createdAt && input && 'protocolId' in input && input.protocolId === protocol.id;
      });
      state.experiments.push({ ...mutation.experiment, preregistered, candidates, id: id(), createdAt: now(), snapshotId: store.db.headRef()!.id });
    } else if (mutation.kind === 'present') {
      const experiment = state.experiments.find(e => e.id === mutation.experimentId);
      if (!experiment) throw new Error('试读不存在');
      if (!state.presentations.some(p => p.experimentId === experiment.id && p.participant === mutation.participant)) {
        const order = experiment.candidates.map(c => c.id);
        for (let i = order.length - 1; i > 0; i--) { const j = randomInt(i + 1); [order[i], order[j]] = [order[j], order[i]]; }
        state.presentations.push({ id: id(), experimentId: experiment.id, participant: mutation.participant, order, createdAt: now() });
      }
    } else if (mutation.kind === 'feedback') {
      const observation = mutation.observation;
      const presentation = state.presentations.find(p => p.id === observation.presentationId);
      if (!presentation) throw new Error('试读展示不存在');
      if (observation.outcome === 'preferred' && (!/^[A-F]$/.test(observation.alias) || !presentation.order[observation.alias.charCodeAt(0) - 65])) throw new Error('请选择已展示的样稿');
      if (observation.outcome !== 'preferred' && observation.alias !== '') throw new Error('非偏好结果不能指定样稿');
      if (state.observations.some(o => o.presentationId === presentation.id && o.state === 'active')) throw new Error('这次试读已提交，请先撤回原反馈');
      if (observation.origin === 'human_target_reader' && !observation.recruitment.trim()) throw new Error('请填写读者来源');
      const experiment = state.experiments.find(e => e.id === presentation.experimentId);
      for (const annotation of observation.annotations) {
        const candidate = experiment?.candidates.find(c => c.id === presentation.order[annotation.alias.charCodeAt(0) - 65]);
        if (!candidate || candidate.hash !== annotation.hash || annotation.end > Array.from(candidate.text).length || Array.from(candidate.text).slice(annotation.start, annotation.end).join('') !== annotation.quote) throw new Error('标记原文与展示样稿不一致');
      }
      state.observations.push({ ...observation, id: id(), state: 'active', createdAt: now() });
    } else if (mutation.kind === 'withdraw') {
      const observation = state.observations.find(o => o.id === mutation.id);
      if (!observation) throw new Error('反馈不存在');
      observation.state = 'withdrawn';
    } else if (mutation.kind === 'pattern') {
      for (const source of mutation.pattern.sources) assertSpan(store, source, true);
      state.patterns.push({ ...mutation.pattern, id: id(), state: 'ready', origin: 'author', runId: '' });
    } else {
      const pattern = state.patterns.find(p => p.id === mutation.id);
      if (!pattern) throw new Error('场景不存在');
      pattern.protectedRepetition = mutation.reason;
    }
    return save(store, state);
  });
}
export function qualityStatistics(store: FileStore, experimentId: string) {
  const state = readQuality(store), experiment = state.experiments.find(e => e.id === experimentId);
  if (!experiment) throw new Error('试读不存在');
  const presentations = state.presentations.filter(p => p.experimentId === experimentId);
  const observations = state.observations.filter(o => presentations.some(p => p.id === o.presentationId));
  const excluded = observations.filter(o => o.excluded || o.state === 'withdrawn').map(o => ({ id: o.id, reason: o.state === 'withdrawn' ? '反馈已撤回' : o.excluded }));
  const strata = (['human_author', 'human_target_reader', 'model_simulation'] as const).map(origin => {
    const rows = observations.filter(o => o.origin === origin && !excluded.some(e => e.id === o.id));
    const wins: Record<string, number> = Object.fromEntries(experiment.candidates.map(c => [c.id, 0]));
    for (const row of rows) if (row.outcome === 'preferred') wins[presentations.find(p => p.id === row.presentationId)!.order[row.alias.charCodeAt(0) - 65]]++;
    return { origin, participants: new Set(rows.map(o => presentations.find(p => p.id === o.presentationId)!.participant)).size, comparisons: rows.length, wins, ties: rows.filter(o => o.outcome === 'tie').length, unsatisfactory: rows.filter(o => o.outcome === 'both_unsatisfactory').length, abstentions: rows.filter(o => o.outcome === 'abstained').length };
  });
  const result = { experimentId, total: observations.length, excluded, strata };
  return { ...result, hash: fingerprint(result) };
}
export function blindPresentation(store: FileStore, presentationId: string) {
  const state = readQuality(store), presentation = state.presentations.find(p => p.id === presentationId);
  if (!presentation) throw new Error('试读展示不存在');
  const experiment = state.experiments.find(e => e.id === presentation.experimentId)!;
  return { id: presentation.id, questions: experiment.questions, candidates: presentation.order.map((key, i) => { const c = experiment.candidates.find(c => c.id === key)!; return { alias: String.fromCharCode(65 + i), text: c.text, hash: c.hash }; }) };
}
export function storeLearnedPreferences(store: FileStore, runId: string, raw: unknown) {
  const values = z.array(voicePreferenceSchema.omit({ id: true, state: true, runId: true })).max(40).parse(raw), state = readQuality(store);
  if (state.preferences.some(p => p.runId === runId)) return;
  for (const value of values) {
    const evidence = value.evidenceIds.map(key => state.evidence.find(e => e.id === key));
    if (evidence.some(e => !e || !evidenceUsable(store, e) || fingerprint(e.scope) !== fingerprint(value.scope))) throw new Error('偏好引用了失效或范围不同的编辑证据');
    const eligible = evidence.filter(e => e!.editor === 'author' && ['expression', 'narrative_focus'].includes(e!.domain) && e!.reason.trim());
    const ready = eligible.length === evidence.length && (value.scope.kind !== 'book' || new Set(eligible.map(e => e!.after.path)).size >= 3);
    state.preferences.push({ ...value, id: id(), runId, state: ready ? 'proposal' : 'insufficient_evidence' });
  }
  save(store, state);
}
export function voiceDocument(store: FileStore, selected: string[]) {
  const state = readQuality(store), preferences = selected.map(key => state.preferences.find(p => p.id === key));
  if (!preferences.length || preferences.some(p => !p || p.state !== 'proposal')) throw new Error('只能应用有有效证据的偏好');
  return `# 声音偏好\n\n\`\`\`json\n${JSON.stringify({ version: 1, preferences }, null, 2)}\n\`\`\`\n`;
}
export function voiceSlice(store: FileStore, scope: VoiceScope) {
  return taskVoicePreferences(store, { entityIds: scope.kind === 'character' ? [scope.target] : [],
    sceneIds: scope.kind === 'scene' ? [scope.target] : [], sceneFunctions: [scope.sceneFunction],
    addresseeIds: scope.addresseeIds, relationshipIds: scope.relationshipIds })
    .map(({ statement, exceptions }) => ({ statement, exceptions }));
}
export interface VoiceSelection {
  entityIds: string[];
  sceneFunctions: string[];
  sceneIds: string[];
  addresseeIds?: string[];
  relationshipIds?: string[];
  scope?: import('../shared/studio').MemoryScope;
}
export function voiceScopeMatches(scope: VoiceScope, selection: VoiceSelection) {
  if (scope.sceneFunction === '未分类') return false;
  if (scope.sceneFunction !== '*' && !selection.sceneFunctions.includes(scope.sceneFunction)) return false;
  if (scope.kind === 'character' && !selection.entityIds.includes(scope.target)) return false;
  if (scope.kind === 'scene' && !selection.sceneIds.includes(scope.target)) return false;
  if (scope.addresseeIds?.length && !scope.addresseeIds.some(id => selection.addresseeIds?.includes(id))) return false;
  if (scope.relationshipIds?.length && !scope.relationshipIds.some(id => selection.relationshipIds?.includes(id))) return false;
  if (scope.exceptSceneFunctions?.some(value => selection.sceneFunctions.includes(value))) return false;
  if (scope.exceptAddresseeIds?.some(id => selection.addresseeIds?.includes(id))) return false;
  return true;
}
export function taskVoicePreferences(store: FileStore, query: string | VoiceSelection, entityIds: string[] = []) {
  if (!store.db.document(voicePath)?.hash) return [];
  const content = store.readAccepted(voicePath).content, match = content.match(/```json\s*([\s\S]*?)```/);
  if (!match) return [];
  try {
    const saved = z.object({ version: z.literal(1), preferences: z.array(voicePreferenceSchema) }).parse(JSON.parse(match[1]));
    const state = readQuality(store);
    const selection: VoiceSelection = typeof query === 'string' ? { entityIds, sceneIds: [query], sceneFunctions: [query] } : query;
    let remainingSamples = 3;
    return saved.preferences.filter(p => p.state === 'proposal' && voiceScopeMatches(p.scope, selection) &&
      state.preferences.some(current => current.id === p.id && current.state === 'proposal' && fingerprint(current) === fingerprint(p)) &&
      p.evidenceIds.every(key => state.evidence.some(e => e.id === key && evidenceUsable(store, e))))
      .slice(0, 12).map(p => {
        const samples = selection.scope?.viewpoint === 'author' ? p.evidenceIds.flatMap(key => {
          const evidence = state.evidence.find(e => e.id === key)!;
          if (!remainingSamples || evidence.editor !== 'author' || !['expression', 'narrative_focus'].includes(evidence.domain) || evidence.scope.sceneFunction === '未分类') return [];
          remainingSamples--;
          return [{ kind: 'expression_sample' as const, text: Array.from(evidence.after.quote).slice(0, 600).join(''), source: { path: evidence.after.path, hash: evidence.after.hash }, instruction: '只参考表达与详略，不继承样例中的人物、物品或情节事实。' }];
        }) : [];
        return { scope: p.scope, statement: p.statement, exceptions: p.exceptions, ...(samples.length ? { samples } : {}) };
      });
  } catch { return []; }
}
export function storePatterns(store: FileStore, runId: string, raw: unknown) {
  const patterns = z.array(patternSchema.omit({ id: true, origin: true, state: true, runId: true })).max(100).parse(raw), state = readQuality(store);
  if (state.patterns.some(p => p.runId === runId)) return;
  for (const pattern of patterns) { for (const source of pattern.sources) assertSpan(store, source, true); state.patterns.push({ ...pattern, id: id(), origin: 'model', state: 'ready', runId }); }
  save(store, state);
}
export function captureCommittedEdit(store: FileStore, path: string, beforeHash: string | null, afterHash: string, editor: 'author' | 'model' | 'imported', chapter: number) {
  if (!path.startsWith('07_') || !beforeHash || beforeHash === afterHash) return;
  const parsed = qualityStateSchema.safeParse(store.db.get(stateKey) ?? { version: 1, revision: 0, evidence: [], preferences: [], patterns: [], experiments: [], presentations: [], observations: [] });
  if (!parsed.success) return;
  const state = parsed.data;
  const identity = hash(`${path}:${beforeHash}:${afterHash}`);
  if (state.evidence.some(e => e.id === identity)) return;
  const before = Array.from(store.object(beforeHash).toString('utf8')), after = Array.from(store.object(afterHash).toString('utf8'));
  let left = 0, right = 0;
  while (left < before.length && left < after.length && before[left] === after[left]) left++;
  while (right < before.length - left && right < after.length - left && before[before.length - 1 - right] === after[after.length - 1 - right]) right++;
  const start = Math.max(0, left - 30);
  const span = (points: string[], hash: string) => { const end = Math.min(points.length, points.length - right + 30, start + 12000); return { path, hash, start, end, quote: points.slice(start, end).join('') }; };
  state.evidence.push({ id: identity, version: 1, before: span(before, beforeHash), after: span(after, afterHash), scope: { kind: 'scene', target: `第${chapter}章`, sceneFunction: '未分类' }, domain: 'unknown', reason: '', editor, state: 'active', createdAt: now() });
  save(store, state);
}
