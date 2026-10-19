import fs from 'node:fs';
import path from 'node:path';
import { Service } from '../../src/core/service';
import { tagBundle, tagHash, renderContract, contractPath } from '../../src/core/tags';
import { paths } from '../../src/core/domain';
import { profileSchema, type ModelResult } from '../../src/shared/types';
import { emptyTagInput } from '../../src/shared/tags';
import { fixture } from '../../tests/fixtures/workflow';

const base = path.resolve('.test-output/planning-language-20261011');
const skill = path.resolve('resources/skill');
const profile = path.join(base, 'electron 中文隔离');
fs.mkdirSync(profile, { recursive: true });
const service = new Service(skill, () => {}, async (_profile, _system, _messages, tools) => {
  const t = service.store!.db.runs().find(run => run.status === 'running')!.planning!;
  const name = tools[0].name;
  const coverage = t.knowledge.options.map(option => ({ optionId: option.id, implementation: '现代城市中的设施故障', firstDemonstration: '检修员记录夜间异常', risk: '不增加全知能力' }));
  const value = name === 'submit_planning_report' ? {
    positioning: '城市局部异常与有限判断', diagnosis: [],
    assumptions: [
      { id: 'A_COMMON_URBAN', text: '正常社会持续运转，异常有局部边界', critical: true, directionIds: [] },
      { id: 'A_D1_RULE', text: '告示可不可靠，真实约束通过记录和可控试验辨认', critical: true, directionIds: ['D1'] },
      { id: 'A_D1_HERO', text: '主角为年轻设施检修员，不具备全知能力', critical: true, directionIds: ['D1'] }
    ],
    directions: ['夜间检修', '条款争议', '群体调查'].map((title, index) => ({
      id: 'D' + (index + 1), title, logline: '检修员在日常故障中发现局部异常', storyEngine: '观察、试验与救援选择', differenceFromOtherDirections: '确认约束的方法不同', openingDecision: '先记录还是先救人', firstVolumeChange: '建立可核对的事故记录', longRunRisk: '避免重复故障', intentChanges: [], tagCoverage: coverage
    })),
    recommendedDirectionId: 'D1', recommendationReasons: ['贴合城市背景与检修员前提'], marketClaims: [], unresolvedQuestions: []
  } : name === 'submit_planning_review' ? { issues: [] } : {
    directionId: t.selectedDirectionId,
    constraints: [{ id: 'C_SCOPE', text: '仅采用夜间检修方向，主角不具备全知能力。', optionIds: t.knowledge.options.map(option => option.id), scope: { entityIds: [], fromChapter: null, toChapter: null }, evidenceRef: t.selectedDirectionId }],
    tagCoverage: coverage, openQuestions: [], premiseDocument: fixture(service.store!.db.project(), paths.seed, service)
  };
  return { text: '', calls: [{ id: crypto.randomUUID(), name, arguments: JSON.stringify(value) }], native: {}, usage: { input: 10, output: 10, cost: 0, currency: 'USD' }, stop: 'tools' } satisfies ModelResult;
});
service.profiles = [{ ...profileSchema.parse({ id: 'fixture', name: '本地模拟', model: 'fixture', protocol: 'chat', baseUrl: 'http://127.0.0.1:1', contextLimit: 1000000 }), apiKey: 'fixture-only' }];
const settled = async () => { for (let i = 0; service.runner?.controller; i++) { if (i > 2000) throw new Error('Fixture timeout'); await new Promise(resolve => setTimeout(resolve, 5)); } };
try {
  const input = emptyTagInput();
  input.selection.reading.main = tagBundle(skill).taxonomy.options.find(option => option.group === 'reading.main' && option.label.includes('都市'))!.id;
  input.premise = '现代城市中的年轻设施检修员';
  const snapshot = await service.invoke('project.create', { parent: base, title: '策划中文说明验收', premise: input.premise, tagInput: input, config: { defaultProfileId: 'fixture', expressionRules: { enabled: false } } });
  const runId = await service.invoke('tags.start', { inputHash: service.snapshot().tagDraft!.inputHash, profileId: 'fixture', requestId: crypto.randomUUID() });
  await settled();
  const initial = service.store!.db.run(runId);
  await service.invoke('tags.selectDirection', { id: runId, directionId: 'D1', reportHash: initial.planning!.reportHash!, resolutions: { A_COMMON_URBAN: '同意', A_D1_RULE: '同意', A_D1_HERO: '同意' } });
  await settled();
  const run = service.store!.db.run(runId), t = run.planning!;
  if (t.phase !== 'ready') throw new Error(run.error ?? 'Fixture not ready');
  t.candidate!.constraints[0].text = '唯一采用D1及作者同意的A_COMMON_URBAN、A_D1_RULE、A_D1_HERO；不引入D2的接受条款机制或D3的群体确认生成规则机制。完整保留mustKeep=[]与mustAvoid=[]。实体ID未提供，暂不伪造；本次仅提交S01候选。';
  t.candidate!.openQuestions = ['mustAvoid清单为空不等于已确认后宫等级，是否继续保留开放问题？'];
  t.contractReview!.hash = tagHash(t.candidate);
  run.changes.find(change => change.path === contractPath)!.content = renderContract(t.spec, t.candidate!);
  service.store!.db.saveRun(run);
  const recent = [{ title: snapshot.project!.title, root: snapshot.project!.root }];
  fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ profiles: [], recent }));
  const result = { project: recent[0], runId, candidateHash: tagHash(t.candidate), reportHash: tagHash(t.report), changesHash: tagHash(run.changes), kind: 'synthetic legacy candidate; no external model requests' };
  fs.writeFileSync(path.join(base, 'fixture.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally { service.close(); }
