import { z } from 'zod';
import type { FileStore } from './storage';
import { factSchema, type Run } from '../shared/types';
import { hash, now, paths, prosePath } from './domain';
import { primaryPath, validateEvidence, encodeFacts } from './memory';
import { pendingSource } from './memory-source';
import { sortImpactFiles, continuityIssues } from './story-impact';
import { contractPath } from './tags';
import { approvedCreation } from '../shared/creation';
import { validateCandidate } from './validation';

function fileProject(store: FileStore, file: string) {
  const project = store.db.project(), chapter = file.match(/第(\d+)章/);
  return chapter ? { ...project, chapter: Number(chapter[1]) } : project;
}

export function memoryRepairScope(repair: NonNullable<Run['memoryRepair']>): Run['continuity'] {
  const creationChange = repair.impacts?.some(impact => impact.creationChange);
  return repair.impacts?.length && repair.impacts.every(impact => impact.scope.mode === 'forward') && repair.paths.every(file => (creationChange ? /^(03_|04_|05_|06_|11_)/ : /^(05_|06_)/).test(file))
    ? { mode: 'forward', fromChapter: Math.min(...repair.impacts.map(impact => impact.scope.fromChapter)) } : undefined;
}

export function prepareMemoryRepair(store: FileStore): NonNullable<Run['memoryRepair']> {
  const project = store.db.project();
  const affected = store.db.facts().filter(fact => fact.reviewStatus !== 'retracted' && fact.state !== 'superseded' &&
    (fact.reviewStatus === 'disputed' || fact.evidence.some(e => store.db.document(e.path)?.hash !== e.hash || pendingSource(project, e.path))));
  const changed = affected.flatMap(fact => fact.evidence.filter(e => store.db.document(e.path)?.hash !== e.hash).map(e => e.path));
  const pending = store.db.sql.prepare("SELECT source FROM review_queue WHERE status='pending'").all();
  const impacts = structuredClone(project.storyImpacts ?? []);
  const baseline = [paths.seed, paths.config, paths.style, paths.world, ...(approvedCreation(project) ? [contractPath] : [])]
    .filter(file => store.db.document(file));
  const forwardOnly = impacts.length > 0 && impacts.every(impact => impact.scope.mode === 'forward') &&
    project.stale.every(file => impacts.some(impact => impact.targets.some(target => target.path === file)));
  const first = Object.keys(project.chapters).map(Number).filter(chapter => project.chapters[chapter] === 'stale').sort((a, b) => a - b)[0];
  const sources = [...new Set([...baseline, ...impacts.flatMap(impact => impact.sources.map(source => source.path)), ...changed,
    ...pending.map(row => String(row.source)), ...(first ? [prosePath(first)] : [])])].filter(file => store.db.document(file));
  const files = [...new Set(forwardOnly ? project.stale : [...project.stale, ...sources.filter(file => !baseline.includes(file)), ...affected.flatMap(fact => [primaryPath(fact), ...fact.evidence.map(e => e.path)])])]
    .filter(file => store.db.document(file) && file !== paths.impact && file !== contractPath);
  return { paths: sortImpactFiles(files), sources, completed: [], cursor: 0, impacts,
    sourceHashes: Object.fromEntries(sources.map(file => [file, store.db.document(file)!.hash!])),
    readonlySources: [...new Set([...baseline, ...impacts.flatMap(impact => impact.sources.map(source => source.path))])]
      .filter(file => !project.stale.includes(file)) };
}

export function memoryRepairRequest(store: FileStore, run: Run, file: string, skillRoot: string) {
  const repair = run.memoryRepair!;
  const read = (path: string) => {
    const content = run.changes.find(change => change.path === path)?.content ?? store.readAccepted(path).content;
    return { path, hash: hash(content), content };
  };
  const facts = store.db.facts().filter(fact => fact.reviewStatus !== 'retracted' && fact.state !== 'superseded' &&
    repair.paths.find(path => path.startsWith('07_') && fact.evidence.some(e => e.path === path)) === file);
  const project = fileProject(store, file);
  const required = validateCandidate(run.stage, project, [{ path: file, content: '', baseHash: null }], skillRoot, 'revision')
    .filter(issue => issue.code === 'missing_field');
  const currentFile = read(file);
  const format = validateCandidate(run.stage, project, [{ ...currentFile, baseHash: store.db.document(file)?.hash ?? null }], skillRoot, 'revision')
    .filter(issue => issue.severity === 'error');
  return {
    authorRequest: run.request,
    scope: run.continuity,
    readonlySources: repair.readonlySources ?? [],
    sourcePolicy: '已确认的变更来源是本次核对依据，不能为了让旧计划成立而改回来源。只读文件可核对和提取记忆，content 必须为 null。发现原始变更也需要调整时，说明冲突并等待作者另行修订。作品方案变更只对生效章节起的未来安排生效：世界规则和人物约定用明确生效范围补充，保留此前已发生事实与历史条款，不能把新计划写成过去事实。',
    stateChanges: repair.impacts?.flatMap(impact => impact.stateChanges) ?? [],
    changeReasons: repair.impacts?.map(impact => ({ reason: impact.reason, scope: impact.scope, targets: impact.targets })) ?? [],
    task: '核对前文修改的影响，仅修复现有内容与记忆，不扩写新章节。不受影响的文稿返回 content:null。每条既有记忆必须保留或替换到 records，或明确放入 withdrawn；不因引用位置改变而丢弃仍成立的事实。新增记录的 state 必须明确为 active 或 resolved，不能照抄旧记录的 disputed/superseded 标记；无法证实则撤回并说明。新增事实同样须有准确原文证据，人物误解不能当成客观事实。',
    file: currentFile,
    formatRequirements: {
      policy: '必需字段保留原名称及所在分节，特别是文件首部字段；用字段内容区分历史、已发生和未来计划，不通过改名或移位表达状态变化。新增后续承接说明以生效章节或全局说明命名，不挂在已完成章节的分节下；此前章节分节和表格行保持不变。每份文件通过格式检查后才继续下游；内容无需修改也须满足现有格式。',
      requiredFields: [...new Set(required.map(issue => issue.message.replace(/^缺少字段：/, '')))],
      checks: [...new Set(format.filter(issue => issue.code !== 'missing_field').map(issue => issue.message))]
    },
    changedSources: repair.sources.filter(path => path !== file).map(read),
    upstreamPlans: repair.completed.filter(item => (repair.impacts?.some(impact => impact.creationChange) ? /^(03_|04_|05_|06_)/ : /^(05_|06_)/).test(item.path) && item.path !== file).map(item => read(item.path)),
    previousFacts: facts,
    acceptedUpdates: run.facts,
    factSchema: z.toJSONSchema(factSchema),
    response: {
      content: '完整修正后的文稿，或 null 表示无需修改；保留既有模板字段',
      reason: '核对结论与依据',
      records: file.startsWith('07_') ? [{ replaces: '被替代的旧记忆 id；新增为 null', reason: '保留、修正或新增的依据', fact: '完整结构化事实，字段遵循总控规则；evidence 为原文 path/hash/quote；有效章节范围、角色认知不可遗漏' }] : [],
      withdrawn: file.startsWith('07_') ? [{ id: '不再成立的旧记忆 id', reason: '撤回原因与新原文依据' }] : []
    }
  };
}

const repairResponse = z.object({
  content: z.string().min(1).nullable(),
  reason: z.string().min(1),
  records: z.array(z.object({ replaces: z.string().nullable(), reason: z.string().min(1), fact: factSchema })),
  withdrawn: z.array(z.object({ id: z.string().min(1), reason: z.string().min(1) }))
});

export function applyMemoryRepairResponse(store: FileStore, run: Run, file: string, text: string, skillRoot: string) {
  const response = repairResponse.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '')));
  const request = memoryRepairRequest(store, run, file, skillRoot);
  const old = request.previousFacts.map(fact => fact.id);
  const decisions = [...response.records.flatMap(record => record.replaces ? [record.replaces] : []), ...response.withdrawn.map(item => item.id)];
  if (new Set(decisions).size !== decisions.length || old.some(id => !decisions.includes(id)) || decisions.some(id => !old.includes(id)))
    throw new Error('记忆同步未完整交代既有记录的保留、替换或撤回');
  if (!file.startsWith('07_') && (response.records.length || response.withdrawn.length))
    throw new Error('只能在复读原文章节时提取事件记忆');
  const content = response.content ?? request.file.content;
  const change = { path: file, content, baseHash: store.db.document(file)!.hash };
  const formatIssues = validateCandidate(run.stage, fileProject(store, file), [change], skillRoot, 'revision').filter(issue => issue.severity === 'error');
  if (formatIssues.length) throw new Error(`当前文件格式需要修正：${formatIssues.map(issue => issue.message).join('；')}`);
  const changes = [...run.changes.filter(item => item.path !== file), change];
  const scopeIssues = continuityIssues(store, { ...run, changes });
  if (scopeIssues.length) throw new Error(scopeIssues.map(issue => issue.message).join('；'));
  const facts = response.records.map((record, index) => {
    const fact = { ...record.fact, id: `memory-${hash(`${run.id}:${file}:${index}`).slice(0, 24)}`, supersedes: record.replaces,
      reviewStatus: 'candidate' as const, acceptedAt: undefined, acceptedRunId: undefined, replacementReason: record.reason };
    if (fact.state === 'disputed' || fact.state === 'superseded') throw new Error('新记忆必须明确是否仍有效，不能沿用旧记录的失效标记');
    if (!fact.evidence.some(e => e.path === file)) throw new Error('本章记忆必须引用本章原文');
    for (const evidence of fact.evidence) {
      const source = changes.find(item => item.path === evidence.path);
      if (source) evidence.hash = hash(source.content);
    }
    const errors = validateEvidence(store, fact, Math.max(store.db.project().chapter, ...run.memoryRepair!.paths.map(path => Number(path.match(/^07_.*第(\d+)章/)?.[1] ?? 0))), changes, run.memoryRepair!.paths);
    if (errors.length) throw new Error(errors.join('；'));
    return fact;
  });
  run.changes = changes;
  run.facts.push(...facts);
  (run.factRetractions ??= []).push(...response.withdrawn);
  run.memoryRepair!.completed.push({ path: file, hash: request.file.hash, reason: response.reason });
  run.memoryRepair!.cursor++;
  run.memoryReview = undefined;
}

export function finishMemoryRepairReport(store: FileStore, run: Run) {
  const facts = structuredClone(store.db.facts());
  for (const fact of run.facts) {
    const old = facts.find(item => item.id === fact.supersedes);
    if (old) {
      old.state = 'superseded';
      if (fact.fromChapter <= old.fromChapter) old.reviewStatus = 'retracted';
      else old.toChapter = fact.fromChapter - 1;
    }
    facts.push(fact);
  }
  for (const retirement of run.factRetractions ?? []) {
    const old = facts.find(item => item.id === retirement.id);
    if (old) { old.state = 'superseded'; old.reviewStatus = 'retracted'; }
  }
  const ledgers = new Set([...run.facts.map(primaryPath), ...facts.filter(fact => run.factRetractions?.some(item => item.id === fact.id)).map(primaryPath)]);
  for (const path of ledgers) {
    const content = run.changes.find(change => change.path === path)?.content ?? store.readAccepted(path).content;
    run.changes = [...run.changes.filter(change => change.path !== path), { path, content: encodeFacts(content, facts.filter(fact => primaryPath(fact) === path)), baseHash: store.db.document(path)!.hash }];
  }
  const content = store.readAccepted(paths.impact).content + `\n\n## ${now()} 记忆同步核对\n\n${run.memoryRepair!.completed.map(item => `- ${item.path}：${item.reason}`).join('\n')}\n\n- 提取与修正记录：${run.facts.length} 条\n- 建议撤回记录：${run.factRetractions?.length ?? 0} 条\n- 状态：待作者审阅，尚未更改正式内容\n`;
  run.changes = [...run.changes.filter(change => change.path !== paths.impact), { path: paths.impact, content, baseHash: store.db.document(paths.impact)!.hash }];
}
