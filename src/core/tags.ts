import fs from 'node:fs';
import path from 'node:path';
import { hash, paths, updateConfigDocument } from './domain';
import {
  tagInputSchema,
  bookSpecSchema,
  creationContractSchema,
  planningReportSchema,
  contractCandidateSchema,
  planningReviewSchema,
  type TagCatalog,
  type TagInput,
  type BookSpec,
  type TagKnowledge,
  type TagPlanning,
  type ApprovedTags,
  type ContractCandidate
} from '../shared/tags';
import type { ProjectState, Run, Issue, Fact } from '../shared/types';
import type { FileStore } from './storage';
import { approvedCreation, creationPlanSchema, planKinds, payoffStages, type CreationPlan } from '../shared/creation';

export const contractPath = '02_项目配置/标签创作契约.md';
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
export const tagHash = (value: unknown) => hash(canonical(value));
export function planningFingerprint(r: Pick<Run, 'planning' | 'baseRevision' | 'baseSnapshotId'>) {
  return tagHash({
    spec: r.planning!.spec,
    knowledge: r.planning!.knowledge,
    baseRevision: r.baseRevision,
    baseSnapshotId: r.baseSnapshotId
  });
}
export function tagBundle(skillRoot: string) {
  const root = path.join(skillRoot, 'tags');
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'resources.lock.json'), 'utf8')) as Record<
    string,
    string
  >;
  const read = (file: string) => {
    const raw = fs.readFileSync(path.join(root, file));
    if (hash(raw) !== lock[file]) throw new Error('标签知识资源完整性检查失败：' + file);
    return JSON.parse(raw.toString('utf8'));
  };
  // Check prompts too: the resource fingerprint includes every bundled rule.
  for (const file of Object.keys(lock))
    if (hash(fs.readFileSync(path.join(root, file))) !== lock[file])
      throw new Error('标签资源已改变：' + file);
  const taxonomy = read('registry/taxonomy.json') as TagCatalog;
  const genres = read('registry/genre-profiles.json').profiles as { mainOptionId: string; label: string }[];
  const cards = read('registry/knowledge-cards.json').cards as { conceptId: string }[];
  const rules = read('registry/combination-rules.json').rules as { allOfConceptIds: string[] }[];
  const recipes = read('registry/recipes.json').recipes as {
    id: string;
    title: string;
    mainOptionIds: string[];
    allOfConceptIds: string[];
  }[];
  if (taxonomy.options.length !== 482 || new Set(taxonomy.options.map((o) => o.id)).size !== 482)
    throw new Error('标签注册表编号或总数不符');
  for (const g of taxonomy.groups)
    if (taxonomy.options.filter((o) => o.group === g.id).length !== g.count)
      throw new Error('标签分组数量不符');
  return { taxonomy, genres, cards, rules, recipes, version: tagHash(lock) };
}
export function selectedIds(input: TagInput) {
  return [
    input.selection.reading.main,
    ...input.selection.reading.theme,
    ...input.selection.reading.role,
    ...input.selection.reading.plot,
    ...input.selection.content.plot,
    ...input.selection.content.emotion,
    ...input.selection.content.persona,
    ...input.selection.content.world
  ].filter(Boolean);
}
export function validateTagInput(raw: unknown, catalog: TagCatalog): TagInput {
  const input = tagInputSchema.parse(raw);
  for (const group of catalog.groups) {
    const [section, field] = group.id.split('.') as ['reading' | 'content', string];
    const value = (input.selection[section] as Record<string, string | string[]>)[field];
    const ids = Array.isArray(value) ? value : [value];
    if (ids.length < group.min || ids.length > group.max || new Set(ids).size !== ids.length)
      throw new Error('标签数量或重复选择不合法：' + group.id);
    for (const id of ids)
      if (!catalog.options.some((o) => o.id === id && o.group === group.id && o.status !== 'retired'))
        throw new Error('未知、停用或错分组的标签：' + id);
  }
  return input;
}
export function makeBookSpec(
  p: ProjectState,
  input: unknown,
  revision: number,
  catalog: TagCatalog
): BookSpec {
  const valid = validateTagInput(input, catalog);
  const value = {
    ...valid,
    projectId: p.id,
    revision,
    taxonomyVersion: catalog.taxonomyVersion,
    preferences: {
      targetWords: p.config.targetWords,
      pov: p.config.pov,
      style: p.config.style,
      constraints: p.config.constraints
    }
  };
  return { ...value, inputHash: tagHash(value) };
}
export function makeCreationSpec(p: ProjectState, input: unknown, revision: number, catalog: TagCatalog): BookSpec {
  const valid = tagInputSchema.parse(input);
  if (valid.selection.reading.main) return makeBookSpec(p, valid, revision, catalog);
  if (selectedIds(valid).length) throw new Error('使用平台标签时必须选择主分类；未覆盖题材可只填写创意');
  if (!valid.premise.trim()) throw new Error('请填写创作想法或选择合法标签');
  const value = { ...valid, projectId: p.id, revision, taxonomyVersion: catalog.taxonomyVersion,
    preferences: { targetWords: p.config.targetWords, pov: p.config.pov, style: p.config.style, constraints: p.config.constraints } };
  return { ...value, inputHash: tagHash(value) };
}
export function compileTags(spec: BookSpec, root: string): TagKnowledge {
  const b = tagBundle(root);
  if (spec.taxonomyVersion !== b.taxonomy.taxonomyVersion) throw new Error('标签库版本不匹配；请先审阅迁移');
  if (!selectedIds(spec).length) {
    if (!spec.premise.trim()) throw new Error('创意开书需要填写想法');
    return { version: b.version, options: [], genre: null, cards: [], rules: [], recipes: [], candidates: [], coverage: [] };
  }
  validateTagInput(
    { selection: spec.selection, premise: spec.premise, mustKeep: spec.mustKeep, mustAvoid: spec.mustAvoid },
    b.taxonomy
  );
  const options = selectedIds(spec).map((id) => b.taxonomy.options.find((o) => o.id === id)!);
  const concepts = new Set(options.map((o) => o.conceptId));
  const cards = b.cards.filter((c) => concepts.has(c.conceptId));
  const recipes = b.recipes.filter((r) => r.mainOptionIds.includes(spec.selection.reading.main));
  return {
    version: b.version,
    options,
    genre: b.genres.find((g) => g.mainOptionId === spec.selection.reading.main),
    cards,
    rules: b.rules.filter((r) => r.allOfConceptIds.every((c) => concepts.has(c))),
    recipes: recipes.filter((r) => r.allOfConceptIds.every((c) => concepts.has(c))),
    candidates: recipes
      .filter(
        (r) =>
          !r.allOfConceptIds.every((c) => concepts.has(c)) &&
          r.allOfConceptIds.filter((c) => concepts.has(c)).length >= 2
      )
      .map((r) => ({ id: r.id, title: r.title, missing: r.allOfConceptIds.filter((c) => !concepts.has(c)) })),
    coverage: options.map((o) => ({
      optionId: o.id,
      level:
        o.group === 'reading.main'
          ? 'genre_draft'
          : cards.some((c) => c.conceptId === o.conceptId)
            ? 'detailed_draft'
            : 'registry_only'
    }))
  };
}
function sameSet(actual: string[], expected: string[], label: string) {
  if (
    new Set(actual).size !== actual.length ||
    actual.length !== expected.length ||
    actual.some((id) => !expected.includes(id))
  )
    throw new Error(label + '存在缺漏、重复或未选择的标签');
}
export function validateReport(value: unknown, planning: TagPlanning) {
  const report = planningReportSchema.parse(value),
    ids = selectedIds(planning.spec);
  const directionIds = report.directions.map((d) => d.id);
  if (new Set(directionIds).size !== 3 || !directionIds.includes(report.recommendedDirectionId))
    throw new Error('方向编号重复或推荐不存在');
  if (new Set(report.assumptions.map((a) => a.id)).size !== report.assumptions.length)
    throw new Error('假设编号重复');
  for (const d of report.directions)
    sameSet(
      d.tagCoverage.map((t) => t.optionId),
      ids,
      '方向 ' + d.title
    );
  for (const d of report.diagnosis)
    if (d.optionIds.some((id) => !ids.includes(id))) throw new Error('诊断引用了未选择或不存在的标签');
  for (const d of report.diagnosis) {
    if (d.assumptionIds.some((id) => !report.assumptions.some((a) => a.id === id)))
      throw new Error('诊断引用了不存在的假设');
    if (
      d.severity === 'needs_confirmation' &&
      !d.assumptionIds.some((id) => report.assumptions.some((a) => a.id === id && a.critical))
    )
      throw new Error('需要确认的诊断必须关联关键假设');
  }
  for (const a of report.assumptions)
    if (a.directionIds.some((id) => !directionIds.includes(id))) throw new Error('假设引用了不存在的方向');
  if (planning.regenerate)
    for (const d of planning.regenerate.original.directions)
      if (
        d.id !== planning.regenerate.directionId &&
        tagHash(d) !== tagHash(report.directions.find((v) => v.id === d.id))
      )
        throw new Error('局部重做改变了应保留的方向');
  return report;
}
export function validateContract(value: unknown, planning: TagPlanning) {
  const c = contractCandidateSchema.parse(value),
    ids = selectedIds(planning.spec);
  if (
    c.directionId !== planning.selectedDirectionId ||
    !planning.report?.directions.some((d) => d.id === c.directionId)
  )
    throw new Error('契约方向不匹配');
  sameSet(
    c.tagCoverage.map((t) => t.optionId),
    ids,
    '契约'
  );
  if (new Set(c.constraints.map((v) => v.id)).size !== c.constraints.length)
    throw new Error('契约约束编号重复');
  for (const v of c.constraints) {
    if (v.optionIds.some((id) => !ids.includes(id))) throw new Error('契约引用了未选择的标签');
    if (v.scope.fromChapter !== null && v.scope.toChapter !== null && v.scope.fromChapter > v.scope.toChapter)
      throw new Error('约束章节范围倒置');
  }
  for (const a of planning.report.assumptions)
    if (
      a.critical &&
      (!a.directionIds.length || a.directionIds.includes(c.directionId)) &&
      !planning.resolutions[a.id]?.trim()
    )
      throw new Error('关键假设尚未确认：' + a.text);
  if (planning.workflowVersion === 2 && !c.plan) throw new Error('请提交完整的结构化作品方案');
  if (c.plan) validateCreationPlan(c.plan, ids, ['author-input', c.directionId, ...c.constraints.map(v => v.id), ...Object.keys(planning.resolutions)]);
  return c;
}
export function validateCreationPlan(raw: unknown, optionIds: string[], sourceRefs?: string[]): CreationPlan {
  const plan = creationPlanSchema.parse(raw);
  const claimIds = plan.statements.map(v => v.id);
  if (new Set(claimIds).size !== claimIds.length) throw new Error('作品方案条目编号重复');
  for (const kind of Object.keys(planKinds))
    if (!plan.statements.some(v => v.kind === kind)) throw new Error('作品方案缺少：' + planKinds[kind as keyof typeof planKinds]);
  for (const statement of plan.statements) {
    if (statement.optionIds.some(id => !optionIds.includes(id))) throw new Error('方案引用了未选择的标签');
    if (!statement.sourceRefs.length || sourceRefs && statement.sourceRefs.some(id => !sourceRefs.includes(id)))
      throw new Error('方案条目缺少有效输入或所选方向依据：' + statement.id);
  }
  sameSet(plan.tagRoles.map(v => v.optionId), optionIds, '标签分工');
  for (const role of plan.tagRoles)
    if (!role.claimIds.length || role.claimIds.some(id => !claimIds.includes(id))) throw new Error('标签分工引用了不存在的方案条目');
  return plan;
}
export function planCandidateHash(r: Run) {
  if (!r.planning?.candidate?.plan) throw new Error('当前任务没有完整作品方案');
  return tagHash({ binding: r.planning.binding, candidate: r.planning.candidate, reportHash: r.planning.reportHash,
    reportReview: r.planning.reportReview, contractReview: r.planning.contractReview, resolutions: r.planning.resolutions });
}
export function assertPlanApproval(r: Run) {
  const t = r.planning;
  if (!t?.planApproval || t.planApproval.hash !== planCandidateHash(r) || t.planApproval.binding !== t.binding || t.planApproval.planHash !== tagHash(t.candidate?.plan))
    throw new Error('作品方案尚未确认或已经改变，请重新确认方案');
}
export function validatePlanningReview(value: unknown, candidate: unknown) {
  const review = planningReviewSchema.parse(value);
  for (const issue of review.issues) {
    if (issue.jsonPointer === '') continue;
    if (!issue.jsonPointer.startsWith('/') || /~(?![01])/.test(issue.jsonPointer))
      throw new Error('审核位置不是有效 JSON Pointer');
    let at: any = candidate;
    for (const part of issue.jsonPointer
      .slice(1)
      .split('/')
      .map((s) => s.replaceAll('~1', '/').replaceAll('~0', '~'))) {
      if (!at || typeof at !== 'object' || !Object.hasOwn(at, part))
        throw new Error('审核引用的候选位置不存在：' + issue.jsonPointer);
      at = at[part];
    }
  }
  return review;
}
export function planningBinding(store: FileStore, r: Run) {
  const t = r.planning;
  if (!t) throw new Error('此任务没有标签策划');
  const draft = store.db.get<BookSpec>('tagDraft');
  if (!draft || draft.inputHash !== t.spec.inputHash || draft.revision !== t.spec.revision)
    throw new Error('标签或作者意图已改变，请基于新输入重新策划');
  const { inputHash, ...input } = t.spec;
  if (tagHash(input) !== inputHash || t.binding !== planningFingerprint(r))
    throw new Error('策划输入或知识版本校验失败');
  if (store.db.project().revision !== r.baseRevision || store.db.get('headSnapshot') !== r.baseSnapshotId)
    throw new Error('策划依据版本已改变');
  if (t.phase === 'ready' && r.changes.length) {
    const configured = structuredClone(store.db.project());
    configured.config.genre = t.knowledge.options.find((o) => o.group === 'reading.main')?.label ?? configured.config.genre;
    if (
      r.changes.find((c) => c.path === paths.config)?.content !==
      updateConfigDocument(store.readAccepted(paths.config).content, configured)
    )
      throw new Error('配置展示与标签主分类映射不一致');
  }
}
export function planningIssues(r: Run): Issue[] {
  if (!r.planning) return [];
  const t = r.planning;
  try {
    if (
      t.phase !== 'ready' ||
      !t.candidate ||
      !t.contractReview ||
      t.contractReview.hash !== tagHash(t.candidate) ||
      t.contractReview.binding !== t.binding
    )
      throw new Error('所选方向的契约尚未完成独立审核');
    if (
      t.reportReview?.binding !== t.binding ||
      t.reportReview?.hash !== tagHash(t.report) ||
      t.reportReview.result.issues.some((i) => i.severity !== 'minor')
    )
      throw new Error('策划报告尚未通过当前输入的独立审核');
    validateReport(t.report, t);
    validateContract(t.candidate, t);
    if (t.contractReview.result.issues.some((i) => i.severity !== 'minor'))
      throw new Error('契约存在需要修正的审核问题');
    const expected = renderContract(t.spec, t.candidate);
    const allowed =
      t.origin === 'new' ? [contractPath, paths.config, paths.seed] : [contractPath, paths.config];
    if (r.facts.length || r.changes.some((c) => !allowed.includes(c.path)))
      throw new Error('标签策划不能改写其他正文或登记事件记忆');
    if (r.changes.find((c) => c.path === contractPath)?.content !== expected)
      throw new Error('契约展示与结构化记录不一致，请重新生成');
    if (
      t.origin === 'new' &&
      r.changes.find((c) => c.path === paths.seed)?.content !== t.candidate.premiseDocument
    )
      throw new Error('设定拆解已改变，需要重新审核');
    // Minor advice remains in the bound review, but does not require a waiver to accept.
    // Blocker/major findings and all deterministic validations above still prevent acceptance.
    return [];
  } catch (e) {
    return [{ code: 'tag_planning', severity: 'error', message: (e as Error).message }];
  }
}
export function renderContract(spec: BookSpec, c: ContractCandidate) {
  const base = renderLegacyContract(spec, c);
  if (!c.plan) return base;
  return base.replace('# 标签创作契约', '# 作品方案与创作契约').replace('“标签与策划”', '“作品方案”')
    + `\n## 作品方案\n\n${c.plan.statements.map(v => `### ${planKinds[v.kind]} · ${v.id}\n\n${v.text}\n\n- 兑现阶段：${payoffStages[v.payoffStage]}\n- 依据：${v.sourceRefs.join('、')}`).join('\n\n')}\n\n## 标签在本书中的分工\n\n${c.plan.tagRoles.map(v => `- ${v.optionId}：${v.implementation}（${v.roles.join('、')}；条目 ${v.claimIds.join('、')}）`).join('\n') || '本书从创意策划，未关联平台标签。'}\n`;
}
function renderLegacyContract(spec: BookSpec, c: ContractCandidate) {
  return `# 标签创作契约\n\n此文档由结构化记录生成，正式生效以作者采纳为准；修改请使用“标签与策划”。\n\n- 标签库：${spec.taxonomyVersion}\n- 输入版本：${spec.revision}\n- 输入指纹：${spec.inputHash}\n- 方向：${c.directionId}\n\n## 作者约定\n${spec.mustKeep
    .map((v) => '- 必须保留：' + v)
    .concat(spec.mustAvoid.map((v) => '- 禁止：' + v))
    .join(
      '\n'
    )}\n\n## 创作约束\n${c.constraints.map((v) => `- ${v.id}：${v.text}（标签 ${v.optionIds.join('、') || '作者意图'}；范围 ${JSON.stringify(v.scope)}）`).join('\n')}\n\n## 标签兑现计划\n${c.tagCoverage.map((v) => `- ${v.optionId}：${v.implementation}\n  首次展示：${v.firstDemonstration}；风险：${v.risk}`).join('\n')}\n\n## 开放问题\n${c.openQuestions.map((v) => '- ' + v).join('\n') || '无'}\n`;
}
const stageDuties: Record<string, string> = {
  S02: '对齐项目配置、文风与禁区',
  S03: '落实世界规则与能力边界',
  S04: '落实角色、关系和知情范围',
  S05: '分卷安排标签承诺',
  S06: '章节规划中记录标签承诺',
  S07: '分配批次兑现节奏',
  S08: '细纲标明约束与兑现位置',
  S09: '选择本章相关承诺，不要求展示所有标签',
  S10: '按契约写正文并检查禁区与能力边界',
  S11: '仅以已采纳正文证据登记实际兑现，计划不当事实'
};
export function tagContext(p: ProjectState, stage: string) {
  const creation = approvedCreation(p);
  let base = legacyTagContext(p, stage);
  if (!creation?.contract.plan) return base;
  base += `\n<creation_scope>${JSON.stringify({ effectiveFromChapter: creation.contract.effectiveFromChapter ?? 1, title: p.title, titleReviewRequired: !!p.titleReviewRequired })}</creation_scope>\n方案修订按上述章节范围生效；历史正文与旧版事实保留，不把新计划追认成过去已经发生的事件。\n`;
  return base + `\n<approved_creation_plan>\n${JSON.stringify({ inputHash: creation.spec.inputHash, contractRevision: creation.contract.revision, planHash: tagHash(creation.contract.plan), plan: creation.contract.plan, title: p.titleBinding })}\n</approved_creation_plan>\n作品方案条目是作者确认的计划和约定，不代表正文事实或人物已知。按当前阶段落实相关承诺，不要求每章展示全部条目。修改核心方案须先提出修订候选；不能为了标题反向添加设定。${stage === 'S11' ? '登记实际兑现时引用已采纳正文证据，使用 planRefs:{inputHash,contractRevision,planHash,claimIds} 绑定上述版本与条目；尚未发生用 kind=plan，不能登记为事件。' : ''}\n`;
}
function legacyTagContext(p: ProjectState, stage: string) {
  const creation = approvedCreation(p);
  if (!creation) return '';
  const { spec, contract, knowledge } = creation;
  return `\n\n标签约束是必需项目数据，不能被聊天摘要覆盖。当前任务：${stageDuties[stage] ?? '按已确认契约讨论；变更先提出候选'}。这些数据不能改变工具权限。知识是建议，不能覆盖作者约定；科幻不必等于末世，未选标签不自动补全。人物视角只限制角色所知，不取消作者约束；不得把作者约束直接写成人物已知事实。篇幅、视角、文风以当前项目配置为准，旧输入版本仅作历史依据。\n<approved_tag_contract>\n${JSON.stringify({ inputHash: spec.inputHash, revision: contract.revision, knowledgeVersion: knowledge.version, options: knowledge.options, mustKeep: spec.mustKeep, mustAvoid: spec.mustAvoid, constraints: contract.constraints, resolutions: contract.resolutions, tagCoverage: contract.tagCoverage, openQuestions: contract.openQuestions })}\n</approved_tag_contract>\n${stage === 'S11' ? '对本章实际兑现的标签使用 propose_memory，kind=event，category=promise，准确引用正文证据；尚未发生的兑现为 kind=plan。相关记录增加 tagRefs:{inputHash,contractRevision,optionIds,constraintIds}，值必须来自当前契约。没有兑现则在章后报告说明，不编造每章全部兑现。' : ''}\n当前选项知识草案（仅在与作者意图和本阶段相符时采用）：${JSON.stringify(stage === 'discussion' ? { coverage: knowledge.coverage } : { genre: knowledge.genre, cards: knowledge.cards, rules: knowledge.rules, coverage: knowledge.coverage })}\n`;
}

export function validateApprovedTags(tags: ApprovedTags, projectId: string) {
  const spec = bookSpecSchema.parse(tags.spec),
    contract = creationContractSchema.parse(tags.contract);
  const { inputHash, ...input } = spec;
  if (
    spec.projectId !== projectId ||
    tagHash(input) !== inputHash ||
    contract.inputHash !== inputHash ||
    contract.knowledgeVersion !== tags.knowledge.version
  )
    throw new Error('正式标签契约的输入或知识版本不一致');
  sameSet(
    tags.knowledge.options.map((o) => o.id),
    selectedIds(spec),
    '知识快照'
  );
  sameSet(
    contract.tagCoverage.map((c) => c.optionId),
    selectedIds(spec),
    '正式契约'
  );
  if (contract.constraints.some((c) => c.optionIds.some((id) => !selectedIds(spec).includes(id))))
    throw new Error('正式约束含未知标签');
  if (contract.plan) {
    validateCreationPlan(contract.plan, selectedIds(spec), ['author-input', contract.directionId, ...contract.constraints.map(v => v.id), ...Object.keys(contract.resolutions)]);
    if (contract.planHash !== tagHash(contract.plan)) throw new Error('正式作品方案指纹不一致');
  }
}
export function approveTags(r: Run, previous: ApprovedTags | undefined, proposalHash: string, effectiveFromChapter = 1): ApprovedTags {
  const t = r.planning!;
  return {
    spec: structuredClone(t.spec),
    knowledge: structuredClone(t.knowledge),
    contract: {
      ...structuredClone(t.candidate!),
      ...(t.candidate!.plan ? { planHash: tagHash(t.candidate!.plan), effectiveFromChapter } : {}),
      constraints: t.candidate!.constraints.map((c) => ({ ...structuredClone(c), authorConfirmed: true })),
      revision: (previous?.contract.revision ?? 0) + 1,
      inputHash: t.spec.inputHash,
      knowledgeVersion: t.knowledge.version,
      resolutions: structuredClone(t.resolutions),
      approval: { runId: r.id, proposalHash, at: new Date().toISOString(), actor: 'local-author' }
    }
  };
}

export function tagFactIssues(f: Fact, tags: ApprovedTags | undefined): string[] {
  if (f.planRefs) {
    const ref = f.planRefs;
    if (!tags?.contract.plan || ref.inputHash !== tags.spec.inputHash || ref.contractRevision !== tags.contract.revision || ref.planHash !== tagHash(tags.contract.plan))
      return ['方案兑现引用的正式版本不匹配'];
    if (new Set(ref.claimIds).size !== ref.claimIds.length || ref.claimIds.some(id => !tags.contract.plan!.statements.some(v => v.id === id)))
      return ['方案兑现引用不存在或重复的条目'];
    if (f.fromChapter < (tags.contract.effectiveFromChapter ?? 1)) return ['不能用新版本方案为生效范围之前的正文登记兑现'];
    if (!['event', 'plan'].includes(f.kind)) return ['方案兑现须为正文事件或明确计划'];
  }
  if (!f.tagRefs) return [];
  const ref = f.tagRefs;
  if (!tags || ref.contractRevision !== tags.contract.revision || ref.inputHash !== tags.spec.inputHash)
    return ['标签兑现引用的正式契约版本不匹配'];
  if (
    ref.optionIds.some((id) => !tags.knowledge.options.some((o) => o.id === id)) ||
    ref.constraintIds.some((id) => !tags.contract.constraints.some((c) => c.id === id))
  )
    return ['标签兑现引用不存在的标签或约束'];
  if (f.kind !== 'event' && f.kind !== 'plan') return ['标签兑现应登记为有正文证据的事件或明确的计划'];
  return [];
}

export function tagImpact(store: FileStore, t: TagPlanning) {
  const p = store.db.project(),
    old = approvedCreation(p);
  const prior = old?.contract.tagCoverage ?? [],
    next = t.candidate?.tagCoverage ?? [];
  const changedOptionIds = [...new Set([...prior, ...next].map((v) => v.optionId))].filter(
    (id) => tagHash(prior.find((v) => v.optionId === id)) !== tagHash(next.find((v) => v.optionId === id))
  );
  const oldConstraints = old?.contract.constraints ?? [],
    newConstraints = t.candidate?.constraints ?? [];
  const changedConstraintIds = [...new Set([...oldConstraints, ...newConstraints].map((v) => v.id))].filter(
    (id) => {
      const previous = oldConstraints.find((c) => c.id === id);
      const { authorConfirmed: _, ...base } = previous ?? {};
      return tagHash(previous ? base : undefined) !== tagHash(newConstraints.find((c) => c.id === id));
    }
  );
  const authorChanged =
    tagHash([old?.spec.premise, old?.spec.mustKeep, old?.spec.mustAvoid]) !==
    tagHash([t.spec.premise, t.spec.mustKeep, t.spec.mustAvoid]);
  const previousPlan = old?.contract.plan;
  const nextPlan = t.candidate?.plan;
  const changedClaimIds = [...new Set([...(previousPlan?.statements ?? []), ...(nextPlan?.statements ?? [])].map(v => v.id))]
    .filter(id => tagHash(previousPlan?.statements.find(v => v.id === id)) !== tagHash(nextPlan?.statements.find(v => v.id === id)));
  const planChanged = tagHash(previousPlan) !== tagHash(nextPlan);
  const known = new Set(
    store.db
      .facts()
      .filter(
        (f) =>
          (f.planRefs && (authorChanged || f.planRefs.claimIds.some(id => changedClaimIds.includes(id)))) || f.tagRefs &&
          (authorChanged ||
            f.tagRefs.optionIds.some((id) => changedOptionIds.includes(id)) ||
            f.tagRefs.constraintIds.some((id) => changedConstraintIds.includes(id)))
      )
      .flatMap((f) => f.evidence.map((e) => e.path))
  );
  const dependent = new Set(
    store.db
      .runs()
      .filter((r) => r.accepted && r.manifest?.sources.some((s) => s.path === contractPath))
      .flatMap((r) => r.changes.map((c) => c.path))
  );
  const affected = store.db
    .acceptedDocuments()
    .filter((d) => /^(01_|03_|04_|05_|06_|07_|08_)/.test(d.path))
    .map((d) => ({
      path: d.path,
      certainty: known.has(d.path) ? 'evidence' : dependent.has(d.path) ? 'dependency' : 'needs_review',
      reason: known.has(d.path)
        ? '已有标签兑现证据'
        : dependent.has(d.path)
          ? '生成时依赖已批准契约'
          : '尚无完整标签依赖证据，需人工核对'
    }));
  return { changedOptionIds, changedConstraintIds, authorChanged, changedClaimIds, planChanged, titleNeedsReview: !!p.titleBinding && planChanged, affected };
}
