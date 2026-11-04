import fs from 'node:fs';
import path from 'node:path';
import type { FileStore } from './storage';
import { hash, prosePath, paths } from './domain';
import { worldContext } from './world-model';
import { creativeInputSchema, creativeOperations, type CreativeTask } from '../shared/creative';
import { memoryScopeSchema } from '../shared/studio';
import { applicableFact, conflictingFacts, sourceValidator, visibleFact } from './memory-studio';
import { pendingSource } from './memory-source';
import { factReadDependency } from './runtime/fact-read-set';
import { fingerprint } from './runtime/canonical';
import { readQuality, evidenceUsable, qualityStatistics, voiceSlice, taskVoicePreferences } from './quality';
import { composeProfessionalMethod } from './creation-policy';
import { resolveCharacterIdentity } from './character-identity';

export function creativeRules(root: string, operation: CreativeTask['input']['operation']) {
  const directory = path.join(root, 'creative-v7');
  const lock = JSON.parse(fs.readFileSync(path.join(directory, 'resources.lock.json'), 'utf8')) as Record<
    string,
    string
  >;
  const catalog = fs.readFileSync(path.join(directory, 'catalog.json'), 'utf8');
  if (hash(catalog) !== lock['catalog.json']) throw new Error('创作工具能力目录完整性检查失败');
  const registration = JSON.parse(catalog).operations.find(
    (entry: { operationId: string; runtimeOperation?: string }) => (entry.runtimeOperation ?? entry.operationId) === operation
  );
  if (!registration?.active || registration.adapter !== 'creative-v7-v1')
    throw new Error('此操作尚无可用适配器');
  const content = fs.readFileSync(path.join(directory, `${operation}.md`), 'utf8');
  if (hash(content) !== lock[`${operation}.md`]) throw new Error('创作工具规则完整性检查失败');
  const assembled = composeProfessionalMethod(root, operation, content);
  return { content: assembled, hash: hash(assembled) };
}

export function rehearsalCharacters(store: FileStore, chapter: number) {
  const facts = store.db.facts({ worldId: 'main', timelineId: 'main' });
  const snapshot = store.db.headRef();
  if (!snapshot) return [];
  const info = store.db.snapshotInfo(snapshot.id),
    validSource = sourceValidator(store, info.documents, chapter, store.db.project());
  const known = facts.filter(
    (fact) =>
      applicableFact(fact, memoryScopeSchema.parse({ chapter })) &&
      !['plan', 'author_constraint'].includes(fact.kind) &&
      fact.evidence.every(validSource)
  );
  const ids = new Set(
    known.flatMap((fact) =>
      fact.knowledge
        .filter(
          (knowledge) =>
            knowledge.fromChapter <= chapter &&
            knowledge.mode !== 'unknown' &&
            (fact.kind === 'belief' || knowledge.mode !== 'misunderstood')
        )
        .map((knowledge) => knowledge.who)
    )
  );
  return [...ids]
    .sort()
    .map((id) => ({
      id,
      name: resolveCharacterIdentity(store, id, memoryScopeSchema.parse({ chapter, viewpoint: 'character', characterId: id }), known).name
    }));
}

export function compileCreative(store: FileStore, root: string, raw: unknown, branchId: string) {
  const input = creativeInputSchema.parse(raw),
    operation = creativeOperations.find((value) => value.id === input.operation)!;
  const project = store.db.project(),
    snapshot = store.db.headRef();
  if (!snapshot) throw new Error('作品缺少可读取的基础版本');
  const rules = creativeRules(root, input.operation);
  const sourceVersions: CreativeTask['sourceVersions'] = [];
  const documents: { source: string; text: string }[] = [];
  const read = (file: string, alias: string, end?: number) => {
    if (pendingSource(project, file) || store.inspect(file)?.status !== 'accepted')
      throw new Error('所选资料尚未保存或因修订待核对');
    const doc = store.readAccepted(file, snapshot.id);
    const points = Array.from(doc.content);
    if (end !== undefined && end > points.length) throw new Error('阅读截止位置超出正文');
    sourceVersions.push({ path: file, hash: doc.hash });
    documents.push({ source: alias, text: file === paths.world ? worldContext(doc.content) : end === undefined ? doc.content : points.slice(0, end).join('') });
  };
  let modelPayload: object;
  let factDependency: CreativeTask['factReadDependency'];
  let parentResultHash: string | undefined;
  let selectionTrace: CreativeTask['selectionTrace'];
  if (input.operation === 'first-read') {
    if ((input.fromChapter ?? 1) > input.throughChapter) throw new Error('阅读起始章节不能晚于截止章节');
    for (let chapter = input.fromChapter ?? 1; chapter <= input.throughChapter; chapter++)
      read(
        prosePath(chapter),
        `chapter-${chapter}`,
        chapter === input.throughChapter ? input.end : undefined
      );
    modelPayload = {
      coverage: {
        kind: (input.fromChapter ?? 1) > 1 ? 'chapter_range' : 'complete_prefix',
        ...((input.fromChapter ?? 1) > 1 ? { fromChapter: input.fromChapter, priorReading: '未提供前文，不代表已完整阅读此前章节；只评价当前章段。' } : {}),
        throughChapter: input.throughChapter,
        end: input.end ?? 'chapter_end'
      },
      displayedTitle: input.displayedTitle,
      displayedDescription: input.displayedDescription,
      documents
    };
  } else if (input.operation === 'rehearse') {
    const scope = memoryScopeSchema.parse({
      chapter: input.chapter,
      viewpoint: 'character',
      characterId: input.characterId
    });
    const selection = { query: input.characterId, entityIds: [input.characterId], chapter: input.chapter };
    const info = store.db.snapshotInfo(snapshot.id),
      all = store.db.factsForTask(scope, selection);
    const validSource = sourceValidator(store, info.documents, input.chapter, project);
    const visible = all.filter(
      (fact) =>
        visibleFact(fact, scope) &&
        fact.evidence.every(validSource) &&
        (fact.kind === 'belief' ||
          fact.knowledge.some(
            (knowledge) =>
              knowledge.who === input.characterId &&
              knowledge.fromChapter <= input.chapter &&
              ['seen', 'told', 'inferred'].includes(knowledge.mode)
          ))
    );
    const conflicts = conflictingFacts(visible);
    const eligible = visible.filter((fact) => !conflicts.has(fact.id));
    if (!eligible.length) throw new Error('尚无该人物在此章可用的知情记录，可先使用探索草稿');
    const identity = resolveCharacterIdentity(store, input.characterId, scope, eligible);
    selectionTrace = { version: 1, entityId: input.characterId, displayName: identity.name, identityBasis: identity.basis, snapshotId: snapshot.id,
      selected: eligible.map(fact => ({ id: fact.id, kind: fact.kind, reason: '本人获知记录及同版来源已核验', readerRevealed: fact.revealedAt <= input.chapter })),
      excluded: all.filter(fact => !eligible.includes(fact)).map(fact => ({ id: fact.id, reason: conflicts.has(fact.id) ? '事实冲突' : !visibleFact(fact, scope) ? '故事位置或人物知情范围不适用' : '来源无效' })) };
    if (identity.basis === 'ambiguous') throw new Error('人物身份记录存在歧义，请先核对该人物的名字与标识');
    const parent = input.parentRunId ? store.db.run(input.parentRunId) : undefined;
    if (parent && (parent.creative?.input.operation !== 'rehearse' || parent.creative.input.chapter > input.chapter || parent.status !== 'complete' || parent.creative.snapshotId !== snapshot.id || !parent.creative.result?.turn)) throw new Error('上一回合已失效、超出当前故事位置或缺少可见行动，请重新开始试演');
    if (parent) parentResultHash = fingerprint(parent.creative!.result!.turn);
    modelPayload = {
      character: identity.name,
      characterId: input.characterId,
      narrationBoundary: { readerThroughChapter: input.chapter,
        privateKnowledge: eligible.filter(fact => fact.revealedAt > input.chapter).map(fact => fact.id),
        instruction: '人物可依据自己的私有信息选择、隐瞒或试探；尚未向读者揭示的信息不得直接写进对白、行动描写或不确定性说明。' },
      chapter: input.chapter,
      observations: input.observations,
      expressionGuidance: taskVoicePreferences(store, { entityIds: [input.characterId], sceneIds: [`第${input.chapter}章`], sceneFunctions: ['对话'], scope }),
      ...(parent ? { visibleInteractionHistory: [{ speaker: '上一位行动者', speech: parent.creative!.result!.turn!.speech, action: parent.creative!.result!.turn!.action }] } : {}),
      beliefs: eligible.map((fact, index) => ({
        source: `observation-${index + 1}`,
        id: fact.id,
        subject: fact.subject,
        statement: `${fact.predicate}：${fact.value}`
      }))
    };
    for (const source of identity.sources)
      if (!sourceVersions.some(version => version.path === source.path && version.hash === source.hash))
        sourceVersions.push({ path: source.path, hash: source.hash });
    for (const fact of eligible)
      for (const evidence of fact.evidence)
        if (!sourceVersions.some((source) => source.path === evidence.path && source.hash === evidence.hash))
          sourceVersions.push({ path: evidence.path, hash: evidence.hash });
    factDependency = factReadDependency(all, scope, selection);
  } else {
    if (input.operation === 'learn-edits') {
      const state = readQuality(store), evidence = input.evidenceIds.map(id => state.evidence.find(e => e.id === id));
      if (evidence.some(e => !e || !evidenceUsable(store, e))) throw new Error('编辑证据已失效，请重新选择');
      modelPayload = { evidence };
      for (const e of evidence) sourceVersions.push({ path: e!.after.path, hash: e!.after.hash });
    } else if (input.operation === 'patterns') {
      for (const chapter of [...new Set(input.chapters)].sort((a, b) => a - b)) read(prosePath(chapter), `chapter-${chapter}`);
      modelPayload = { request: input.request, documents: documents.map((d, i) => ({ ...d, path: sourceVersions[i].path, hash: sourceVersions[i].hash })), patterns: readQuality(store).patterns.filter(p => p.state === 'ready' && input.chapters.includes(p.chapter)), coverage: { chapters: input.chapters, complete: true } };
    } else if (input.operation === 'compare-feedback') {
      const state = readQuality(store), experiment = state.experiments.find(e => e.id === input.experimentId);
      if (!experiment) throw new Error('试读不存在');
      const ids = state.presentations.filter(p => p.experimentId === experiment.id).map(p => p.id);
      modelPayload = { experiment, statistics: qualityStatistics(store, experiment.id), observations: state.observations.filter(o => ids.includes(o.presentationId)) };
    } else {
    const protocol = input.protocolId ? readQuality(store).protocols.find(p => p.id === input.protocolId) : undefined;
    if (input.protocolId && !protocol) throw new Error('创作实验方案不存在');
    if (protocol && protocol.configurationHash !== fingerprint(project.config)) throw new Error('项目参数与预登记版本不同，请重新登记实验');
    for (const [index, file] of [...new Set(input.sources)].entries()) read(file, `source-${index + 1}`);
    modelPayload = {
      task: input.prompt,
      ...(protocol ? { experimentProtocol: protocol } : {}),
      authorConstraints: project.config.constraints,
      ...(input.operation === 'explore' && (input.preferences || input.exploration) ? { preferences: input.preferences ?? '', allowedExploration: input.exploration ?? '' } : {}),
      documents,
      authority: '这是隔离探索。未提供的信息保持未知，新设定单列为待选假设；草稿尚未进入作品。'
      ,...(input.operation === 'voice-pilot' ? { scope: input.scope, preferences: voiceSlice(store, input.scope), protectedStory: '仅改变表达，不增加人物身份、能力、事件或剧情结果；作者要求保留的原句必须保持。' } : {})
    };
    }
  }
  const binding: CreativeTask = {
    version: 1,
    input,
    audience: operation.audience,
    branchId,
    rulesHash: rules.hash,
    packetHash: fingerprint(modelPayload),
    snapshotId: snapshot.id,
    sourceVersions,
    factReadDependency: factDependency,
    ...(selectionTrace ? { selectionTrace } : {}),
    ...(parentResultHash ? { parentResultHash } : {}),
    audienceHash: fingerprint({
      project: project.id,
      branchId,
      snapshot: snapshot.id,
      input,
      policy: rules.hash,
      audience: operation.audience
    })
  };
  return { system: rules.content, modelPayload, binding };
}
