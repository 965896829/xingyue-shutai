import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app, safeStorage } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { Service } from '../src/core/service';
import { invokeModel } from '../src/core/provider';
import { hash, prosePath, paths } from '../src/core/domain';
import { factSchema } from '../src/shared/types';
import { proposalHash } from '../src/core/storage';
import { encodeFacts } from '../src/core/memory-records';
import { mutateQuality, readQuality } from '../src/core/quality';
import { Conversations } from '../src/core/conversations';
import type { SecretProfile } from '../src/shared/types';
import type { CreativeInput } from '../src/shared/creative';

const output = path.resolve('.test-output/xingyue-v7/live-quality');
fs.mkdirSync(output, { recursive: true });
const budgetFile = path.join(output, 'budget.json');
const budget = fs.existsSync(budgetFile) ? JSON.parse(fs.readFileSync(budgetFile, 'utf8')) : { authorized: 100, dispatched: 0, attempts: [] };
const persist = () => fs.writeFileSync(budgetFile, JSON.stringify(budget, null, 2));
const seeds = [
  ['都市', '电梯停在两层之间，维修工阿宁必须让害怕迟到的老人接受先断电。老人不知道故障原因，阿宁不能保证救援时间。'],
  ['悬疑', '调查员林桥在旧账本发现日期被改。看门人认为是雨水损坏，实际原因尚未揭示。用行为让双方产生分歧，不揭露真相。'],
  ['历史', '驿站剩两匹疲马，信使与大夫都急需出发。掌柜要在不伤害马匹的前提下作出选择，不能突然出现第三匹马。'],
  ['科幻', '空间站氧气阀维修失败，工程师提出让温室暂时休眠，植物学家担心种子。争执结束时只有试验方案，没有奇迹。'],
  ['现实', '小店店主收到退货，顾客说用了三天便坏。店主先相信产品没有问题，随后发现自己的包装错误，承担后果。'],
  ['奇幻', '学徒只能点亮一盏灯，地下渡口有两个岔道。伙伴误以为他能照亮整条河。选择照亮一条路，保持能力限制。']
];
const authDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyue-eval-auth-'));
const authState = path.join(app.getPath('appData'), 'wenxu-desktop', 'Local State');
if (fs.existsSync(authState)) fs.copyFileSync(authState, path.join(authDirectory, 'Local State'));
app.setPath('userData', authDirectory);
async function main() {
fs.writeFileSync(path.join(output, 'startup.txt'), 'waiting for Electron');
await app.whenReady();
fs.appendFileSync(path.join(output, 'startup.txt'), '\nElectron ready');
try {
  const settings = JSON.parse(fs.readFileSync(path.join(app.getPath('appData'), 'wenxu-desktop/settings.json'), 'utf8'));
  const db = new DatabaseSync(path.join(settings.recent[0].root, '.novelclient/state.sqlite'), { readOnly: true });
  const current = JSON.parse(String(db.prepare('SELECT value FROM kv WHERE key=?').get('project')!.value)); db.close();
  const configured = settings.profiles.find((p: SecretProfile) => p.id === current.config.defaultProfileId);
  if (!configured?.enabled || !configured.encryptedKey) throw new Error('默认模型不可用');
  const { encryptedKey, ...publicProfile } = configured;
  const profile: SecretProfile = { ...publicProfile, apiKey: safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')), outputLimit: Math.min(configured.outputLimit, 8192), timeoutSeconds: 180, tools: false };
  fs.writeFileSync(path.join(output, 'configuration.json'), JSON.stringify({ model: profile.model, profileId: profile.id, protocol: profile.protocol, outputLimit: profile.outputLimit, contextLimit: profile.contextLimit, authorizedRequests: 100, evaluation: '30 original synthetic scene prompts, two variants; five sequential scenes; reader-prefix isolation', literaryQualityVerified: false }, null, 2));
  fs.rmSync(path.join(authDirectory, 'Local State'), { force: true });
  type EvaluationRecord = { label: string; runId: string; status: string; elapsedMs: number; input: CreativeInput; content: string; hash?: string; binding?: unknown; usage?: unknown; error?: string };
  const resultsFile = path.join(output, 'results.json');
  const records: EvaluationRecord[] = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : [];
  const service = new Service(path.resolve('resources/skill'), () => {}, async (...args) => {
    if (budget.dispatched >= budget.authorized) throw new Error('评测调用预算耗尽');
    const ordinal = ++budget.dispatched, startedAt = Date.now();
    const requestHash = hash(JSON.stringify({ system: args[1], messages: args[2], tools: args[3] }));
    const attempt = { ordinal, startedAt, requestHash, status: 'dispatched', elapsedMs: 0 };
    budget.attempts.push(attempt); persist();
    try { const result = await invokeModel(...args); Object.assign(attempt, { status: 'complete', elapsedMs: Date.now() - startedAt, usage: result.usage }); persist(); return result; }
    catch (error) { Object.assign(attempt, { status: 'failed_or_unknown', elapsedMs: Date.now() - startedAt, error: (error as Error).name }); persist(); throw error; }
  });
  service.profiles = [profile];
  const parent = path.join(output, 'projects'); fs.mkdirSync(parent, { recursive: true });
  if (records.length) {
    const roots = fs.readdirSync(parent, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(parent, e.name));
    const root = roots.find(root => {
      const file = path.join(root, '.novelclient/state.sqlite');
      if (!fs.existsSync(file)) return false;
      const database = new DatabaseSync(file, { readOnly: true });
      try { return Boolean(database.prepare('SELECT id FROM runs WHERE id=?').get(records[0].runId)); } finally { database.close(); }
    });
    if (!root) throw new Error('原评测作品未找到，停止以免重复付费请求');
    await service.invoke('project.open', { root });
  } else await service.invoke('project.create', { parent, title: `质量验收-${Date.now()}`, premise: '隔离评测作品', config: { defaultProfileId: profile.id, maxRounds: 1, stageBudget: null } });
  let store = service.store!;
  const run = async (label: string, input: CreativeInput) => {
    const existing = records.find(r => r.label === label);
    if (existing) return existing;
    const startedAt = Date.now(), runId = await service.invoke('creative.run', { profileId: profile.id, input });
    let result = store.db.run(runId);
    while (!['complete', 'failed', 'paused', 'stale', 'unknown', 'needs_repair'].includes(result.status)) { await new Promise(resolve => setTimeout(resolve, 200)); result = store.db.run(runId); }
    const record = { label, runId, status: result.status, elapsedMs: Date.now() - startedAt, input, content: result.creative?.result?.content ?? '', hash: result.creative?.result?.hash, binding: result.creative, usage: result.usage, error: result.error };
    records.push(record); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(records, null, 2));
    console.log(JSON.stringify({ label, status: result.status, requests: budget.dispatched, elapsedMs: record.elapsedMs }));
    return record;
  };
  for (let i = 0; i < 30 && budget.dispatched < 80; i++) {
    const [genre, premise] = seeds[i % seeds.length], sceneFunction = ['对话', '行动', '情绪', '转场', '兑现'][Math.floor(i / 6)];
    const base = `写一个${genre}小说的${sceneFunction}场景，约250—400汉字。${premise} 不讲解写作方法，不总结道理。`;
    const a = await run(`scene-${i + 1}-A`, { operation: 'explore', prompt: base, sources: [] });
    const b = await run(`scene-${i + 1}-B`, { operation: 'explore', prompt: base + ' 本次用可观察的动作、物件和具体对白承载心理变化，保留上述事实和结局。', sources: [] });
    if (a.status === 'complete' && b.status === 'complete' && a.content !== b.content && !readQuality(store).experiments.some(e => e.title === `场景${i + 1}·${genre}·${sceneFunction}`)) {
      const q = readQuality(store);
      mutateQuality(store, q.revision, { kind: 'experiment', experiment: { title: `场景${i + 1}·${genre}·${sceneFunction}`, kind: 'voice_fixed_story', stage: 'development', family: `原创族-${i % seeds.length}`, sceneFunction, audience: '目标题材读者', variedFactors: ['prompt'], constraints: premise, questions: ['哪篇更愿意继续阅读？', '人物和剧情事实是否保持一致？'] }, candidates: [{ text: a.content, runId: a.runId }, { text: b.content, runId: b.runId }] });
    }
    if (records.slice(-4).every((r: any) => r.status !== 'complete') && records.length >= 4) break;
  }
  for (let chapter = 1; chapter <= 5 && budget.dispatched < 90; chapter++) {
    const result = await run(`continuation-${chapter}`, { operation: 'explore', prompt: `继续写第${chapter}章，约500—800汉字。主角阿宁是普通维修工，没有超能力。五章讲清电梯故障排查、发现错误、承担责任、验证方案、恢复运行。延续已提供正文中的人物状态与因果，推进一个具体步骤。`, sources: chapter > 1 ? [prosePath(chapter - 1)] : [] });
    if (result.status !== 'complete') break;
    const runRecord = store.db.run(result.runId), draft = new Conversations(store).readDraft(runRecord.creative!.result!.draftId!);
    const file = prosePath(chapter), currentHash = store.db.document(file)?.hash ?? null;
    if (currentHash !== hash(draft.content)) store.commit([{ path: file, content: draft.content, baseHash: currentHash }], store.db.project());
    if (chapter === 5) await run('first-read-five-chapters', { operation: 'first-read', throughChapter: 5, displayedTitle: '停在半层', displayedDescription: '' });
  }
  if (process.argv.includes('--extended')) {
    const evidenceFile = prosePath(6), before = '阿宁望着门，心里十分焦急。', after = '阿宁又按了一次门铃。';
    let quality = readQuality(store);
    if (!quality.evidence.some(e => e.reason === '合成验收：用可见动作表达焦急，仅适用于本场对话。')) {
      store.commit([{ path: evidenceFile, content: before, baseHash: store.db.document(evidenceFile)?.hash ?? null }], store.db.project());
      store.commit([{ path: evidenceFile, content: after, baseHash: hash(before) }], store.db.project());
      quality = mutateQuality(store, readQuality(store).revision, { kind: 'evidence', evidence: { before: { path: evidenceFile, hash: hash(before), quote: before, start: 0, end: Array.from(before).length }, after: { path: evidenceFile, hash: hash(after), quote: after, start: 0, end: Array.from(after).length }, scope: { kind: 'scene', target: '合成门前场景', sceneFunction: '对话' }, domain: 'expression', reason: '合成验收：用可见动作表达焦急，仅适用于本场对话。', editor: 'author' } });
    }
    await run('voice-learn-synthetic-edit', { operation: 'learn-edits', evidenceIds: [quality.evidence.find(e => e.reason.startsWith('合成验收：'))!.id] });
    await run('voice-pilot-scoped', { operation: 'voice-pilot', prompt: '阿宁等待开门，结尾门没有打开。约250字。只展示这个等待场景。', scope: { kind: 'scene', target: '合成门前场景', sceneFunction: '对话' }, sources: [evidenceFile] });
    await run('patterns-two-chapters', { operation: 'patterns', chapters: [2, 3], request: '比较两章主人公面对问题时的策略、回应和结果，允许有意承接。每章只选一个最有证据的场景。' });
    const first = store.readAccepted(prosePath(1)), quote = Array.from(first.content).slice(0, 350).join('');
    const identity = factSchema.parse({ id: 'eval-an-observation', entityIds: ['AN'], subject: '阿宁', predicate: '眼前场景', value: quote, kind: 'event', category: 'character', fromChapter: 1, revealedAt: 1, reviewStatus: 'accepted', knowledge: [{ who: 'AN', mode: 'seen', fromChapter: 1 }], evidence: [{ path: prosePath(1), hash: first.hash, quote, start: 0, end: Array.from(quote).length }] });
    if (!store.db.facts().some(f => f.id === identity.id)) store.commit([{ path: paths.knowledge, content: encodeFacts('# 知情边界', [identity]), baseHash: store.db.document(paths.knowledge)?.hash ?? null }], store.db.project());
    const turn = await run('rehearsal-one', { operation: 'rehearse', characterId: 'AN', chapter: 1, observations: '老人问：“什么时候能出去？”阿宁尚不知道需要多久。' });
    if (turn.status === 'complete') await run('rehearsal-followup', { operation: 'rehearse', characterId: 'AN', chapter: 1, parentRunId: turn.runId, observations: '老人听完后安静下来，把手从门缝边收了回去。' });
    const label = 'atomic-memory-review';
    if (!records.some(r => r.label === label) && budget.dispatched <= 94) {
      const startedAt = Date.now(), runId = await service.invoke('design.run', { profileId: profile.id, input: { id: 'memory-delta.extract', chapter: 1, request: '合成验收：保留最终正文，核对人物覆盖和核心记忆，不改变正文。' } });
      let value = store.db.run(runId);
      while (value.status === 'running' || value.status === 'awaiting_review' && value.revisionCore?.phase !== 'ready') { await new Promise(resolve => setTimeout(resolve, 200)); value = store.db.run(runId); }
      records.push({ label, runId, status: value.status, elapsedMs: Date.now() - startedAt, input: { operation: 'patterns', chapters: [1], request: 'core-review' }, content: value.responseText, usage: value.usage, error: value.error });
      fs.writeFileSync(resultsFile, JSON.stringify(records, null, 2));
    }
  }
  if (process.argv.includes('--resume-core') || process.argv.includes('--repair-core')) {
    const label = process.argv.includes('--repair-core') ? 'atomic-memory-format-repair-v2' : 'atomic-memory-review-resumed';
    const source = records.find(r => r.label === 'atomic-memory-review');
    if (source && !records.some(r => r.label === label)) {
      await service.invoke('project.configure', { config: { ...store.db.project().config, maxRounds: 8, chapterWords: 650, minWords: 450, maxWords: 850 } });
      const startedAt = Date.now(), runId = await service.invoke('run.resume', { id: source.runId });
      await new Promise(resolve => setTimeout(resolve, 250));
      let value = store.db.run(runId);
      while (service.runner!.controller || value.status === 'running' || value.status === 'awaiting_review' && value.revisionCore?.phase !== 'ready') { await new Promise(resolve => setTimeout(resolve, 200)); value = store.db.run(runId); }
      records.push({ label, runId, status: value.status, elapsedMs: Date.now() - startedAt, input: source.input, content: value.responseText, usage: value.usage, error: value.error });
      fs.writeFileSync(resultsFile, JSON.stringify(records, null, 2));
    }
  }
  if (process.argv.includes('--core-v2') && !records.some(r => r.label === 'atomic-memory-current-contract')) {
    await service.invoke('project.configure', { config: { ...store.db.project().config, maxRounds: 8, chapterWords: 650, minWords: 450, maxWords: 850 } });
    const startedAt = Date.now(), baseline = store.db.headRef()!.id;
    const runId = await service.invoke('design.run', { profileId: profile.id, input: { id: 'memory-delta.extract', chapter: 1, request: '合成验收：保留第一章最终正文，遵循文档格式，核对本章记忆与覆盖。' } });
    await new Promise(resolve => setTimeout(resolve, 250));
    let value = store.db.run(runId);
    while (service.runner!.controller || value.status === 'running') { await new Promise(resolve => setTimeout(resolve, 200)); value = store.db.run(runId); }
    if (value.status === 'awaiting_review' && !value.issues.some(i => i.severity === 'error')) {
      await service.invoke('run.accept', { id: runId, proposalHash: proposalHash(value), warningReason: '隔离合成验收：保留文学建议，验证正文和记忆同版提交。' });
      fs.writeFileSync(path.join(output, 'atomic-commit-proof.json'), JSON.stringify({ runId, baseline, committedSnapshot: store.db.headRef()!.id, proseHash: store.db.document(prosePath(1))!.hash, coverageHash: value.revisionCore!.coverage[1].proseHash, facts: value.facts.length, chapter: store.db.project().chapter }, null, 2));
      value = store.db.run(runId);
    }
    records.push({ label: 'atomic-memory-current-contract', runId, status: value.status, elapsedMs: Date.now() - startedAt, input: { operation: 'patterns', chapters: [1], request: 'core-review' }, content: value.responseText, usage: value.usage, error: value.error ?? value.issues.filter(i => i.severity === 'error').map(i => i.message).join('；') });
    fs.writeFileSync(resultsFile, JSON.stringify(records, null, 2));
  }
  if (process.argv.includes('--core-final') && !records.some(r => r.label === 'atomic-memory-final-repair')) {
    const source = records.find(r => r.label === 'atomic-memory-current-contract');
    if (!source) throw new Error('缺少待修复任务，停止以免重做评测');
    await service.invoke('project.configure', { config: { ...store.db.project().config, maxRounds: 14 } });
    const startedAt = Date.now(), baseline = store.db.headRef()!.id;
    const runId = await service.invoke('run.resume', { id: source.runId });
    await new Promise(resolve => setTimeout(resolve, 250));
    let value = store.db.run(runId);
    while (service.runner!.controller || value.status === 'running') { await new Promise(resolve => setTimeout(resolve, 200)); value = store.db.run(runId); }
    if (value.status === 'awaiting_review' && !value.issues.some(i => i.severity === 'error')) {
      await service.invoke('run.accept', { id: runId, proposalHash: proposalHash(value), warningReason: '隔离合成验收：保留文学建议，验证正文和记忆同版提交。' });
      fs.writeFileSync(path.join(output, 'atomic-commit-proof.json'), JSON.stringify({ runId, baseline, committedSnapshot: store.db.headRef()!.id, proseHash: store.db.document(prosePath(1))!.hash, coverageHash: value.revisionCore!.coverage[1].proseHash, facts: value.facts.length, chapter: store.db.project().chapter }, null, 2));
      value = store.db.run(runId);
    }
    records.push({ label: 'atomic-memory-final-repair', runId, status: value.status, elapsedMs: Date.now() - startedAt, input: source.input, content: value.responseText, usage: value.usage, error: value.error ?? value.issues.filter(i => i.severity === 'error').map(i => i.message).join('；') });
    fs.writeFileSync(resultsFile, JSON.stringify(records, null, 2));
  }
  if (process.argv.includes('--holdout')) {
    const cases = [
      { family: 'holdout-archive', genre: '历史日常', sceneFunction: '日常', premise: '地方书坊的校对员沈芜发现将要付印的族谱把一名养女漏掉。家主不在，管事催印，沈芜只能停机一炷香并请账房核对旧册。结尾尚未决定增补，不能发明身世反转。' },
      { family: 'holdout-bridge', genre: '近未来经营', sceneFunction: '高潮余波', premise: '桥梁检查员许澄完成临时加固，运菜司机仍不敢过桥。许澄不能保证永不出错，只能公开荷载记录并建议车辆分批通行。结尾第一辆车安全通过，两人仍要守到天亮。无超能力和秘密阴谋。' }
    ];
    for (const sample of cases) {
      const specification = { title: `独立保留场景·${sample.genre}`, kind: 'voice_fixed_story' as const, stage: 'holdout' as const, family: sample.family, sceneFunction: sample.sceneFunction, audience: '目标题材读者', variedFactors: ['prompt'], constraints: sample.premise + ' 两版均为250—400汉字，保持事件、行动、知情和结局。', questions: ['更愿意继续阅读哪篇？', '人物行动与结果是否符合要求？'] };
      let state = readQuality(store), protocol = state.protocols.find(p => p.family === sample.family);
      if (!protocol) {
        state = mutateQuality(store, state.revision, { kind: 'protocol', protocol: { ...specification, maxCalls: 2, comparisonRule: '作者和目标读者分开；以独立读者及故事族计数；同时保留平局、都不满意和弃权。', exclusionRule: '结构失败保留但不展示为空白；长度超出范围单列，不裁剪、不重抽；两次生成后停止。' } });
        protocol = state.protocols.at(-1)!;
      }
      const base = `写一个${sample.genre}小说的${sample.sceneFunction}场景，250—400汉字。${sample.premise} 不解释写作方法，不总结道理。`;
      const a = await run(`${sample.family}-A`, { operation: 'explore', protocolId: protocol.id, prompt: base, sources: [] });
      const b = await run(`${sample.family}-B`, { operation: 'explore', protocolId: protocol.id, prompt: base + ' 用可观察的动作、物件与对白承载心理变化，保持既定事件、行动和结局。', sources: [] });
      state = readQuality(store);
      if (a.status === 'complete' && b.status === 'complete' && !state.experiments.some(e => e.family === sample.family)) mutateQuality(store, state.revision, { kind: 'experiment', experiment: { ...specification, protocolId: protocol.id }, candidates: [{ text: a.content, runId: a.runId }, { text: b.content, runId: b.runId }] });
    }
  }
  if (process.argv.includes('--semantic')) {
    const mainRoot = store.root, semanticFile = path.join(output, 'semantic-project.json');
    if (fs.existsSync(semanticFile)) await service.invoke('project.open', { root: JSON.parse(fs.readFileSync(semanticFile, 'utf8')).root });
    else {
      await service.invoke('project.create', { parent, title: `语义边界验收-${Date.now()}`, premise: '独立合成测试作品', config: { defaultProfileId: profile.id, maxRounds: 1, stageBudget: null } });
      fs.writeFileSync(semanticFile, JSON.stringify({ root: service.store!.root }));
    }
    store = service.store!;
    const prose = [
      '库房的锁没有撬痕。甲在门外捡到一小块蓝布，塞进衣袋。谁拿走钥匙仍无答案。\n\n守门人说：“先把货留下，明早再问。”甲方才还坚持等清点结果，听见这句，却立刻把三车货全部送走。他没有解释为什么改主意，也没有再看那块布。',
      '甲负责清点库房。他亲眼见过丙借钥匙，因此相信丙偷走了钥匙，急于找回钥匙保护货物。甲遇到疑点会先当面追问。丁负责与货主协商，目标是让货物安全交接。丁遇到疑点会先保留双方说法、请各方核对，避免未证实的指控。实际取走钥匙的是乙，甲和丁都不知道这一事实。',
      '赵青在码头被众人嘲笑没有资格。她一直隐瞒自己获准掌管船队，等掌柜要赶她走，才当众亮出调船令。众人看见印章全都愣住，掌柜立即把船让给她。',
      '周岚在药铺被众人轻视。她一直隐瞒自己获准主持药会，等掌柜要赶她走，才当众亮出药师金牌。众人看见金牌全都愣住，掌柜立即把药柜让给她。',
      '师父把伞交给徒弟：“你走前面。”徒弟攥紧伞柄，不敢反驳，走进雨里为师父挡风。师父始终留在他身后。',
      '多年后，徒弟已能独立带队。旧师父受伤，他把伞交还：“你走前面。”这次他请师父先到屋檐下歇息，自己留在雨里接应其他人。师父点头，不再命令他。',
      '校对员把日期从六月十二改为六月十三。阿宁在门口等候，她焦急地看着门，她心里十分焦急。',
      '可使用的职业资料：许澄是桥梁检查员，负责记录现象并交给有资质的人员确认。没有材料强度、许可荷载、作者经历或事故内幕资料。语气样例：“她把笔搁下，等对方说完。”样例中的人物事件不属于当前故事。'
    ];
    if (!store.db.get('semantic-seeded')) {
      store.commit(prose.map((content, i) => ({ path: prosePath(i + 1), content, baseHash: store.db.document(prosePath(i + 1))?.hash ?? null })), store.db.project());
      const source = store.readAccepted(prosePath(2));
      const facts = [
        ['A', '甲', '认为', '丙偷走了钥匙', 'belief', 'misunderstood'],
        ['A', '甲', '目标与策略', '找回钥匙保护货物；先当面追问', 'event', 'seen'],
        ['D', '丁', '目标与策略', '让货物安全交接；先保留双方说法并核对，避免未证实的指控', 'event', 'seen'],
        ['B', '乙', '实际行动', '取走了钥匙，甲和丁都不知道', 'event', 'seen']
      ].map(([who, subject, predicate, value, kind, mode], i) => factSchema.parse({ id: `semantic-${i}`, subject, predicate, value, kind, category: 'character', entityIds: [who], fromChapter: 2, revealedAt: 2, reviewStatus: 'accepted', knowledge: [{ who, mode, fromChapter: 2 }], evidence: [{ path: prosePath(2), hash: source.hash, quote: source.content }] }));
      store.commit([{ path: paths.knowledge, content: encodeFacts('# 知情边界', facts), baseHash: store.db.document(paths.knowledge)?.hash ?? null }], store.db.project());
      const file = prosePath(7), before = prose[6], after = '校对员把日期从六月十二改为六月十四。阿宁在门口等候，她焦急地看着门。';
      store.commit([{ path: file, content: after, baseHash: hash(before) }], store.db.project());
      const span = (text: string, quote: string) => { const start = Array.from(text.slice(0, text.indexOf(quote))).length; return { path: file, hash: hash(text), start, end: start + Array.from(quote).length, quote }; };
      const scope = { kind: 'scene', target: '校对与等候', sceneFunction: '日常' };
      let q = readQuality(store);
      q = mutateQuality(store, q.revision, { kind: 'evidence', evidence: { before: span(before, '六月十三'), after: span(after, '六月十四'), scope, domain: 'fact_correction', reason: '改正日期', editor: 'author' } });
      mutateQuality(store, q.revision, { kind: 'evidence', evidence: { before: span(before, '她焦急地看着门，她心里十分焦急。'), after: span(after, '她焦急地看着门。'), scope, domain: 'unknown', reason: '', editor: 'author' } });
      store.db.set('semantic-seeded', true);
    }
    if (!store.db.get('semantic-goal-types')) {
      const current = store.db.facts();
      const corrected = current.map(f => ['semantic-1', 'semantic-2'].includes(f.id) ? { ...f, kind: 'event' as const } : f);
      if (JSON.stringify(current) !== JSON.stringify(corrected)) store.commit([{ path: paths.knowledge, content: encodeFacts('# 知情边界', corrected), baseHash: store.db.document(paths.knowledge)!.hash }], store.db.project());
      store.db.set('semantic-goal-types', true);
    }
    const eligible = readQuality(store).evidence.filter(e => e.scope.target === '校对与等候');
    await run('V6-Q-24-corrections', { operation: 'learn-edits', evidenceIds: eligible.map(e => e.id) });
    await run('V6-Q-25-bounded-material', { operation: 'voice-pilot', scope: { kind: 'scene', target: '桥梁现场', sceneFunction: '行动' }, sources: [prosePath(8)], prompt: '写许澄在桥头劝司机暂缓通行的短场景，200—300字。已知桥面有新裂缝，关键材料和荷载尚未核实，不能发明确定数值、事故内幕或作者个人经历。以等候专业核验结束。' });
    const pressure = '有人催你立刻打开库房门放货，说再耽搁就要误工。你只能回应一句话并作出自己的一个动作。';
    await run('V6-Q-26-and-27-character-A', { operation: 'rehearse', characterId: 'A', chapter: 2, observations: pressure });
    const a = await run('V6-Q-27-character-A-current', { operation: 'rehearse', characterId: 'A', chapter: 2, observations: pressure });
    await run('V6-Q-27-character-D', { operation: 'rehearse', characterId: 'D', chapter: 2, observations: pressure });
    if (a.status === 'complete') await run('V6-Q-29-ambiguous-threat', { operation: 'rehearse', characterId: 'A', chapter: 2, parentRunId: a.runId, observations: '对方低声说：“你等着，很快你就明白了。”' });
    await run('V6-Q-28-author-scope', { operation: 'explore', prompt: '写200—300字探索场景：普通电工阿宁与亲生女儿被困停电车库，允许新增一名普通配角和求援方法。锁定阿宁没有超能力，父女关系不变，结尾仍未脱困。关键新增设定单列为待选假设。', sources: [] });
    await run('V6-Q-30-reader-gap', { operation: 'first-read', throughChapter: 1, displayedTitle: '库房的钥匙', displayedDescription: '' });
    await run('V6-Q-31-renamed-solution', { operation: 'patterns', chapters: [3, 4], request: '比较实际策略、对方回应与解决过程，说明人名地点不同是否带来实质变化；只引用当前原文。' });
    await run('V6-Q-32-intentional-echo', { operation: 'patterns', chapters: [5, 6], request: '作者明确希望以相同对白形成有意回响。比较前后的权力关系、选择与结果，不因词句重复自动删改。' });
    await run('V6-Q-34-incompatible-branches', { operation: 'explore', prompt: '尝试合并两个候选的兼容局部：甲方案中阿宁已知道门锁损坏，所以选择从后门进入；乙方案中阿宁仍不知道门锁损坏，在正门等待同伴。可保留共同的夜雨与工具箱细节；未授权改变获知事件、强行决定先后或让人物突然知道真相。互斥的部分明确列为待选，允许只写150字兼容片段。', sources: [] });
    fs.writeFileSync(path.join(output, 'semantic-quality-state.json'), JSON.stringify(readQuality(store), null, 2));
    await service.invoke('project.open', { root: mainRoot }); store = service.store!;
  }
  if (process.argv.includes('--identity-recheck')) {
    const mainRoot = store.root;
    await service.invoke('project.open', { root: JSON.parse(fs.readFileSync(path.join(output, 'semantic-project.json'), 'utf8')).root }); store = service.store!;
    const value = await run('V6-Q-27-identity-recheck', { operation: 'rehearse', characterId: 'A', chapter: 2, observations: '有人催你立刻打开库房门放货，说再耽搁就要误工。你只能回应一句话并作出自己的一个动作。' });
    if (value.status === 'complete') await run('V6-Q-29-identity-recheck', { operation: 'rehearse', characterId: 'A', chapter: 2, parentRunId: value.runId, observations: '对方低声说：“你等着，很快你就明白了。”' });
    await service.invoke('project.open', { root: mainRoot }); store = service.store!;
  }
  fs.writeFileSync(path.join(output, 'quality-state.json'), JSON.stringify(readQuality(store), null, 2));
  fs.writeFileSync(path.join(output, 'completion.json'), JSON.stringify({ completedAt: new Date().toISOString(), dispatched: budget.dispatched, projectRoot: store.root, records: records.length, complete: records.filter(r => r.status === 'complete').length }, null, 2));
  await service.drain();
  app.exit(0);
} catch (error) {
  fs.writeFileSync(path.join(output, 'failure.txt'), (error as Error).message);
  console.error((error as Error).message); app.exit(1);
}
}
void main().catch(error => { fs.writeFileSync(path.join(output, 'failure.txt'), String(error)); process.exitCode = 1; });
