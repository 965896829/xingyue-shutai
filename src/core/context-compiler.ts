import type { ContextManifest, ContextSource, DocumentInfo, Fact, Profile, ProjectState, StageId } from '../shared/types';
import { memoryScopeSchema, type MemoryScope } from '../shared/studio';
import { FileStore, fileHash, safePath } from './storage';
import { hash, id, now, paths, requiredInputs, prosePath, updatePath, taskPath, detailPath, activeBatch, batchPath, rhythmPath } from './domain';
import { contractPath } from './tags';
import { approvedCreation } from '../shared/creation';
import { rebuildMemory, primaryPath } from './memory-records';
import { applicableFact, conflictingFacts, retrieveMemory, scopedRead, scopeSnapshotInfo, sourceValidator, visibleFact, writingScope } from './memory-studio';
import { pendingSource } from './memory-source';
import { contextAllowance, countInput } from './context-budget';
import { chapterSlice, endingSlice } from './context-slices';
import { contextDependencies } from './context-dependencies';
import { compatibleSettingsSnapshot, currentSettingsSourceHash } from './runtime-settings';
import { selectMemoryDiagnostics } from './memory-diagnostics';
import { characterVoiceSlice } from './character-voice';
import { factReadDependency, factReadSetChanged } from './runtime/fact-read-set';
import { taskVoicePreferences, voicePath } from './quality';
import { worldContext } from './world-model';
import { plotPath, plotContext } from './workbench-plot';
import { fingerprint } from './runtime/canonical';
import { bookProfilePath, bookProfileContext } from './publishing';
import { sceneMaterials, writingMaterials } from './scene-material';
import { modelFact } from './model-memory';
import { stageSources } from './stage-context';
import type { PromptPhase } from './prompt-profile';
import { bindContextReadPlan, checkContextReadPlan, importantCurrentFact } from './context-reading';

export interface CompileOptions {
  purpose?: NonNullable<ContextManifest['purpose']>;
  scope?: MemoryScope;
  allowConflicts?: boolean;
  strictChapterInputs?: boolean;
  resident?: unknown;
  toolCount?: number;
  deferBudgetCheck?: boolean;
  onMemoryDiagnostics?: (result: ReturnType<typeof selectMemoryDiagnostics>) => void;
}

export function contextPayload(manifest: ContextManifest, project?: ProjectState, phase: PromptPhase = 'tools') {
  const restricted = manifest.scope && manifest.scope.viewpoint !== 'author';
  const canUse = (fact: Fact) => !restricted || fact.kind === 'author_constraint' || visibleFact(fact, manifest.scope!);
  return {
    contextPolicy: '作者规则必须遵守，但不是人物已知事实；事实块仅限当前视角。未揭示内容仅用于避免提前揭密，不能写成已经发生或人物已经知道。计划不是事实。',
    scope: manifest.scope, entities: manifest.entityIds,
    authorRules: manifest.hardConstraints?.filter(canUse).map(f => modelFact(f, manifest.scope)), revelation: restricted && manifest.revelation
      ? { ...manifest.revelation, withheld: manifest.revelation.withheld.map(({ id, revealedAt }) => ({ id, revealedAt, reason: '本范围不可揭示的事实，内容未装入' })) }
      : manifest.revelation,
    facts: manifest.retrievedFacts?.filter(canUse).map(f => modelFact(f, manifest.scope)), coverage: manifest.coverage, conflicts: manifest.conflicts,
    disputedRecords: manifest.disputedFacts?.map(f => modelFact(f, manifest.scope)),
    sources: project ? stageSources(manifest, project, phase).sources : manifest.sources,
    ...(phase !== 'memory' && manifest.voicePreferences?.length ? { voicePreferences: manifest.voicePreferences } : {}),
    ...(phase !== 'memory' && manifest.writingMaterials ? { writingMaterials: manifest.writingMaterials } : {})
  };
}

export function fitContext(manifest: ContextManifest, profile: Profile, resident: unknown = '', toolCount = 0, rejectOverflow = true, project?: ProjectState) {
  checkContextReadPlan(manifest);
  const allowance = contextAllowance(profile, toolCount), residentTokens = countInput(profile, resident).tokens;
  manifest.availableTokens = Math.max(0, allowance.availableInput - residentTokens);
  const measure = () => countInput(profile, contextPayload(manifest, project));
  let size = measure();
  while (size.tokens > manifest.availableTokens) {
    const at = manifest.sources.findLastIndex(s => !s.required);
    if (at < 0) break;
    const [source] = manifest.sources.splice(at, 1);
    manifest.omitted!.push({ path: source.path, reason: '相关原文因本次输入预算未装入，可按需回查' });
    size = measure();
  }
  const required = new Set(manifest.requiredFactIds ?? []);
  while (size.tokens > manifest.availableTokens && manifest.disputedFacts?.length) {
    const fact = manifest.disputedFacts.pop()!;
    manifest.omitted!.push({ path: primaryPath(fact), reason: '可选争议记录超出预算，未作为事实使用' });
    size = measure();
  }
  while (size.tokens > manifest.availableTokens) {
    const at = manifest.retrievedFacts?.findLastIndex(f => !required.has(f.id)) ?? -1;
    if (at < 0) break;
    const [fact] = manifest.retrievedFacts!.splice(at, 1);
    manifest.omitted!.push({ path: primaryPath(fact), reason: `可选记忆“${fact.subject}：${fact.predicate}”因输入预算未装入` });
    size = measure();
  }
  manifest.factIds = [...new Set([...(manifest.retrievedFacts ?? []), ...(manifest.hardConstraints ?? [])].map(f => f.id))];
  checkContextReadPlan(manifest);
  size = measure();
  manifest.estimatedTokens = size.tokens;
  const { availableInput, ...details } = allowance;
  manifest.budget = { ...details, residentTokens, method: size.method, inputBytes: size.bytes };
  if (size.tokens > manifest.availableTokens && rejectOverflow) throw new Error(`必读资料超过输入预算（${size.method === 'utf8_upper_bound' ? '字节保守上界' : '本地分词估计'} ${size.tokens}，可用 ${manifest.availableTokens}）。请缩小任务范围或选择容量更大的模型；作者硬规则与揭示边界未被删除，本次没有发送请求。`);
  return manifest;
}

function related(fact: Fact, query: string, entities: Set<string>) {
  return fact.scope === 'global' || fact.entityIds.some(e => entities.has(e)) || [fact.subject, ...fact.aliases].some(n => n && query.includes(n));
}

export function compileContext(store: FileStore, p: ProjectState, stage: StageId, request: string, profile: Profile, options: CompileOptions = {}): ContextManifest {
  const purpose = options.purpose ?? 'stage';
  const scope = memoryScopeSchema.parse({ ...writingScope(p), projectId: p.id, ...options.scope });
  if (scope.chapter !== p.chapter || scope.mode !== 'current') throw new Error('生成资料包必须使用当前任务章号和当前正式版本');
  const snapshot = scopeSnapshotInfo(store, scope);
  if (snapshot.project.revision !== p.revision) throw new Error('作品版本已变化，请重新组装资料');
  const checked = new Map<string, DocumentInfo | undefined>();
  const status = { get(file: string) { if (!checked.has(file)) checked.set(file, store.inspect(file)); return checked.get(file); } };
  if (store.db.get<number>('indexRevision') !== p.revision) rebuildMemory(store);
  const m: ContextManifest = {
    id: id(), projectId: p.id, inputHash: hash(request), selectedBy: 'context-compiler-v1', purpose,
    scope, snapshotId: snapshot.id, projectRevision: p.revision, chapter: p.chapter, stage,
    sources: [], factIds: [], retrievedFacts: [], hardConstraints: [], requiredFactIds: [], entityIds: [],
    revelation: { allowed: [], withheld: [], characterUnknown: [] }, conflicts: [], estimatedTokens: 0,
    availableTokens: 0, createdAt: now(), omitted: [], assemblyVersion: '4.0-context-compiler'
  };
  const formal = purpose === 'stage' || purpose === 'revision';
  const planned = formal ? requiredInputs(stage, p) : [paths.config, paths.style, ...(stage >= 'S04' ? [paths.world] : []), ...(purpose === 'draft' && stage >= 'S09' ? [paths.volumes, paths.outline, batchPath(activeBatch(p)), rhythmPath(activeBatch(p)), taskPath(p.chapter), detailPath(p.chapter), ...(p.chapter > 1 ? [prosePath(p.chapter - 1)] : [])] : [])];
  // S09 uses the current chapter's plan and entry/exit neighbors. Character
  // records still supply the first chapter's baseline before prose facts exist.
  const required = planned.filter(file => !(stage >= 'S10' && file.startsWith('04_') && file !== paths.summary));
  if (stage >= 'S09' && purpose !== 'discussion')
    for (let n = Math.max(1, p.chapter - p.config.recentChapters); n < p.chapter; n++) if (snapshot.documents[updatePath(n)]) required.push(updatePath(n));
  if (approvedCreation(p)) required.push(contractPath);
  if (scope.viewpoint === 'author' && snapshot.documents[bookProfilePath]) required.push(bookProfilePath);
  if (scope.viewpoint === 'author' && stage >= 'S06' && snapshot.documents[plotPath]) required.push(plotPath);
  for (const file of [...new Set(required)]) {
    const authorRule = file === paths.world || file === paths.config || file === paths.style || file === contractPath || file === paths.seed || file === bookProfilePath;
    if (scope.viewpoint !== 'author' && !authorRule && /^(04_|09_)/.test(file)) { m.omitted!.push({ path: file, reason: '人物视角使用有来源的结构化事实，不装入未分离知情范围的摘要' }); continue; }
    const doc = status.get(file);
    const problem = !doc || doc.status === 'missing' ? `缺少本阶段必读资料：${file}` : doc.status !== 'accepted' ? `必读资料存在待确认的外部修改：${file}` : pendingSource(p, file) ? `资料因前文修订待核对：${file}` : '';
    if (problem) {
      if (options.strictChapterInputs && /^(05_|06_|07_)/.test(file)) throw new Error(problem);
      if (options.allowConflicts || (!formal && !doc)) { m.conflicts.push(problem); m.omitted!.push({ path: file, reason: problem }); continue; }
      throw new Error(problem);
    }
    let source: { content: string; hash: string; ranges?: { start: number; end: number }[] };
    try { source = scope.viewpoint !== 'author' && file.startsWith('07_') ? scopedRead(store, file, scope) : store.readAccepted(file, snapshot.id); }
    catch (error) { if (!options.allowConflicts) throw error; m.conflicts.push((error as Error).message); continue; }
    let slice = { content: source.content, ranges: source.ranges ?? [{ start: 0, end: Array.from(source.content).length }], omitted: !!source.ranges };
    let reason = authorRule ? '作者必守规则，不代表人物已知' : '当前任务必读';
    if (stage === 'S09' && file === batchPath(activeBatch(p))) {
      slice = chapterSlice(source.content, Math.max(activeBatch(p).start, p.chapter - 1), Math.min(activeBatch(p).end, p.chapter + 1));
      if (slice.omitted) reason = '全局说明、本章及相邻承接计划；完整来源仍绑定同一版本';
    }
    else if (stage >= 'S09' && /^(05_|06_)/.test(file)) { slice = chapterSlice(source.content, p.chapter); if (slice.omitted) reason = '全局说明及本章所属计划'; }
    else if (stage >= 'S06' && /^(05_|06_)/.test(file)) {
      const batch = activeBatch(p);
      slice = chapterSlice(source.content, batch.start, batch.end);
      if (slice.omitted) reason = '全局说明及当前批次涉及的全部计划范围';
    }
    if (file === prosePath(p.chapter - 1) && scope.viewpoint !== 'character') { slice = endingSlice(source.content); reason = '前章结尾，完整原文可按需回查'; }
    if (slice.omitted) m.omitted!.push({ path: file, reason: file.startsWith('07_') ? '前章较早部分未常驻；保留结尾及精确范围，可回查全文' : '任务范围外的计划未常驻；全局说明及当前章或批次涉及部分保留，完整原文可回查' });
    const layer: ContextSource['layer'] = authorRule ? 'author_rules' : file.startsWith('07_') ? 'prose' : file.startsWith('04_') || file.startsWith('08_') ? 'summary' : 'chapter_plan';
    m.sources.push({ path: file, hash: source.hash, content: slice.content, ranges: slice.ranges, mode: slice.omitted || scope.viewpoint === 'character' && file.startsWith('07_') ? 'excerpt' : 'full', required: true, reason, layer, sourceSnapshotId: snapshot.id,
      category: authorRule ? 'author_instruction' : layer === 'prose' ? 'accepted_prose' : layer === 'summary' ? 'derived_summary' : 'plan' });
    if (scope.viewpoint === 'character' && file.startsWith('07_')) {
      m.sources.at(-1)!.category = 'formal_fact';
      m.sources.at(-1)!.reason = '当前人物可见事实的投影；ranges 定位宿主证据，content 不含原文中的邻接信息';
    }
    if (file === paths.world && source.content.startsWith('# 世界模块')) m.sources.at(-1)!.content = worldContext(source.content, p.chapter);
    if (file === bookProfilePath) { m.sources.at(-1)!.content = bookProfileContext(source.content); m.sources.at(-1)!.mode = 'excerpt'; m.sources.at(-1)!.reason = '作者当前创作题材与发布归类，仅装入选择结果'; }
    if (file === plotPath) { m.sources.at(-1)!.content = plotContext(source.content, p.chapter); m.sources.at(-1)!.reason = '作者确认的本章场景与因果连接'; }
  }
  const query = [request, scope.characterId ?? '', ...m.sources.filter(s => s.layer === 'chapter_plan' || s.path === prosePath(p.chapter - 1)).map(s => s.content)].join('\n');
  const all = store.db.facts(scope);
  m.factReadDependency = factReadDependency(all, scope);
  const validSource = sourceValidator(store, snapshot.documents, scope.chapter, p);
  const candidates = all.filter(f => f.kind !== 'expression_sample' && f.worldId === scope.worldId && f.timelineId === scope.timelineId && f.reviewStatus === 'accepted' && f.state !== 'disputed' && (applicableFact(f, { ...scope, viewpoint: 'author' }) || f.state !== 'superseded' && f.revealedAt > p.chapter));
  const entities = new Set<string>(scope.characterId ? [scope.characterId] : []);
  for (const f of candidates) if ([f.subject, ...f.aliases, ...f.entityIds].some(n => n && query.includes(n))) for (const entity of f.entityIds) entities.add(entity);
  const usable = candidates.filter(f => (related(f, query, entities) || ['world_rule', 'author_constraint'].includes(f.kind)) && f.evidence.every(e => validSource(e) && status.get(e.path)?.status === 'accepted'));
  m.entityIds = [...entities].sort();
  if (store.db.document(voicePath)?.hash) {
    const plans = m.sources.filter(source => source.layer === 'chapter_plan').map(source => source.content).join('\n');
    const scenes = sceneMaterials(m.sources);
    const sceneFunctions = [...plans.matchAll(/(?:场景功能|章节类型|场景类型)[：:]\s*([^\r\n]+)/g)].flatMap(match => match[1].split(/[、,，；;\/]/).map(value => value.trim()));
    m.voicePreferences = taskVoicePreferences(store, { entityIds: scope.characterId ? [scope.characterId] : m.entityIds,
      sceneFunctions, sceneIds: [`第${p.chapter}章`, ...[...plans.matchAll(/^#{2,4}\s+(.+)$/gm)].map(match => match[1].trim())],
      addresseeIds: scenes.flatMap(s => s.addressees?.split(/[、,，]/).map(v => v.trim()) ?? []),
      relationshipIds: scenes.flatMap(s => s.relationship ? [s.relationship] : []), scope });
    m.qualityReadHash = fingerprint({ records: store.db.get('creative-quality-v1'), voice: store.db.document(voicePath)?.hash });
  }
  if (stage === 'S10' && purpose !== 'discussion' && scope.viewpoint === 'author' && !m.sources.some(source => source.path === paths.roles)) {
    const card = status.get(paths.roles);
    if (card?.status === 'accepted' && !pendingSource(p, paths.roles)) {
      const doc = store.readAccepted(paths.roles, snapshot.id);
      const voice = characterVoiceSlice(doc.content, [request, ...m.sources.filter(source => source.layer === 'chapter_plan').map(source => source.content), ...entities].join('\n'));
      if (voice) m.sources.push({ path: paths.roles, hash: doc.hash, content: voice.content, ranges: voice.ranges,
        mode: 'excerpt', required: true, layer: 'author_rules', category: 'author_instruction', sourceSnapshotId: snapshot.id,
        reason: '本章人物的说话与做事风格；只指导表达，不表示人物知晓秘密，不包含完整台账或事实块' });
    }
  }
  const current = all.filter(f => f.kind !== 'expression_sample' && applicableFact(f, { ...scope, viewpoint: 'author' }));
  const usableIds = new Set(usable.map(f => f.id));
  const conflicts = conflictingFacts(current);
  const obligations = current.filter(f => ['active', 'superseded'].includes(f.state) && (['world_rule','author_constraint'].includes(f.kind) || ((f.mandatory || ['injury','promise','hook'].includes(f.category)) && related(f, query, entities))));
  for (const fact of obligations) {
    if (!usableIds.has(fact.id) || conflicts.has(fact.id)) { m.conflicts.push(`${fact.subject}：${fact.predicate} 的来源或状态需要核对`); continue; }
    m.hardConstraints!.push(fact);
    if (!visibleFact(fact, scope)) m.revelation!.characterUnknown.push(fact.id);
  }
  for (const fact of usable) {
    if (!related(fact, query, entities) && !['world_rule','author_constraint'].includes(fact.kind)) continue;
    if (fact.revealedAt > p.chapter) m.revelation!.withheld.push({ id: fact.id, subject: fact.subject, predicate: fact.predicate, value: fact.value, revealedAt: fact.revealedAt, reason: '本章尚未允许揭示，只用于防止提前泄露，不是人物已知事实', evidence: fact.evidence });
    else if (fact.revealedAt === p.chapter) m.revelation!.allowed.push(fact.id);
  }
  const found = retrieveMemory(store, query, scope, 12, undefined, validSource);
  m.coverage = found.coverage;
  m.disputedFacts = found.disputes;
  const hardIds = new Set(m.hardConstraints!.map(f => f.id));
  m.retrievedFacts = found.facts.filter(x => x.fact.kind !== 'expression_sample' && !hardIds.has(x.fact.id) && (purpose === 'discussion' || x.fact.revealedAt <= p.chapter)).map(x => x.fact);
  m.requiredFactIds = found.facts.filter(x => x.required).map(x => x.fact.id);
  // Select core state independently of ranked recall. A low relevance score must
  // never remove a participating character's injury, possession or belief.
  if (['S09', 'S10'].includes(stage) && purpose !== 'discussion') {
    for (const fact of current.filter(f => importantCurrentFact(f) && related(f, query, entities))) {
      if (!visibleFact(fact, scope) || fact.revealedAt > p.chapter) continue;
      if (conflicts.has(fact.id) || !fact.evidence.every(e => validSource(e) && status.get(e.path)?.status === 'accepted')) {
        m.conflicts.push(`${fact.subject}：${fact.predicate} 的必读依据缺失或存在冲突`); continue;
      }
      if (!hardIds.has(fact.id) && !m.retrievedFacts.some(f => f.id === fact.id)) m.retrievedFacts.push(fact);
      if (!m.requiredFactIds.includes(fact.id)) m.requiredFactIds.push(fact.id);
    }
  }
  const diagnostics = selectMemoryDiagnostics(store, { scope, query, sourcePaths: m.sources.filter(source => !(source.path === paths.roles && source.category === 'author_instruction' && source.mode === 'excerpt')).map(s => s.path), entityIds: m.entityIds });
  options.onMemoryDiagnostics?.(diagnostics);
  m.conflicts.push(...found.issues, ...diagnostics.blocking);
  for (const issue of diagnostics.isolated)
    m.omitted!.push({ path: issue.path, reason: '与当前任务无关的失效记忆已隔离；原问题保留在记忆管理中，未作为本次事实使用' });
  if (stage >= 'S09' && purpose !== 'discussion') m.conflicts.push(...found.coverage.filter(c => c.status === 'missing').map(c => `缺少连续性台账：${c.ledger}`));
  m.conflicts = [...new Set(m.conflicts)];
  if (m.conflicts.length && !options.allowConflicts) throw new Error(`记忆来源需要核对：${m.conflicts.slice(0, 4).join('；')}`);
  for (const doc of found.documents) {
    if (m.sources.some(s => s.path === doc.path) || status.get(doc.path)?.status !== 'accepted') continue;
    m.sources.push({ path: doc.path, hash: doc.hash, content: doc.excerpt, ranges: [{ start: doc.start, end: doc.end }], required: false, mode: 'excerpt', reason: '本章人物或事件相关原文', layer: 'prose', sourceSnapshotId: snapshot.id, category: 'accepted_prose' });
  }
  if (scope.viewpoint !== 'author') {
    for (const source of m.sources.filter(source => [paths.seed, paths.world].includes(source.path as typeof paths.world))) {
      const selected = usable.filter(f => (f.kind === 'author_constraint' || visibleFact(f, scope)) && f.evidence.some(e => e.path === source.path));
      const quotes = selected.flatMap(f => f.evidence).filter(e => e.path === source.path);
      source.content = selected.map(f => f.kind === 'author_constraint'
        ? f.evidence.filter(e => e.path === source.path).map(e => e.quote).join('\n')
        : `${f.subject} · ${f.kind} · ${f.predicate}：${f.value}`).join('\n\n');
      source.ranges = quotes.flatMap(e => e.start !== undefined && e.end !== undefined ? [{ start: e.start, end: e.end }] : []);
      source.mode = 'excerpt'; source.reason = '适用作者约束与当前视角可见记录';
    }
  }
  if (['S09', 'S10'].includes(stage) && purpose !== 'discussion') {
    m.writingMaterials = writingMaterials(store, m);
    m.qualityReadHash = fingerprint({ records: store.db.get('creative-quality-v1'), voice: store.db.document(voicePath)?.hash });
  }
  bindContextReadPlan(m);
  return fitContext(m, profile, options.resident, options.toolCount, !options.deferBudgetCheck, p);
}

export function assembleContext(store: FileStore, p: ProjectState, stage: StageId, request: string, profile: Profile, allowConflicts = false, options: CompileOptions = {}) {
  return compileContext(store, p, stage, request, profile, { ...options, purpose: options.purpose ?? (allowConflicts ? 'revision' : 'stage'), allowConflicts });
}

export function contextChanged(store: FileStore, manifest: ContextManifest) {
  if (manifest.qualityReadHash && manifest.qualityReadHash !== fingerprint({ records: store.db.get('creative-quality-v1'), voice: store.db.document(voicePath)?.hash })) return true;
  if (manifest.factReadDependency && factReadSetChanged(store, manifest.factReadDependency)) return true;
  if (manifest.snapshotId && store.db.get('headSnapshot') !== manifest.snapshotId &&
      !compatibleSettingsSnapshot(store, manifest.snapshotId)) return true;
  return contextDependencies(manifest).some(s =>
    fileHash(safePath(store.root, s.path)) !== currentSettingsSourceHash(store, manifest.snapshotId, s));
}
