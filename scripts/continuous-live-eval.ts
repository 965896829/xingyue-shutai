import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app, safeStorage } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { Service } from '../src/core/service';
import { invokeModel, requestBody, RequestError } from '../src/core/provider';
import { atomicWrite, proposalHash } from '../src/core/storage';
import { hash, paths, stageOutputs, activeBatch, batchPath, rhythmPath, prosePath, updatePath, countWords, renderConfig, renderProgress } from '../src/core/domain';
import { attempts } from '../src/core/runtime/model-gateway';
import { templates } from '../src/core/skill';
import { readWorldModel, renderWorldModel } from '../src/core/world-model';
import type { SecretProfile, Run } from '../src/shared/types';
import { decodeNarrativeResponse } from '../src/shared/narrative-events';
import { ProjectCommitService } from '../src/core/runtime/commit-kernel';
import { futurePlanTargets, makeStoryImpact } from '../src/core/story-impact';
import { initialFiles } from '../src/core/skill';

// Explicitly opt in. This harness uses the normal Service/runner/gateway and never supplies model responses.
const throughThirty = process.argv.includes('--authorized-through-30');
if (!throughThirty && !process.argv.includes('--authorized-120')) throw new Error('需要显式的评估调用授权');
const output = path.resolve('.test-output/audit-0497/live');
fs.mkdirSync(output, { recursive: true });
const save = (name: string, value: unknown) => atomicWrite(path.join(output, name), JSON.stringify(value, null, 2));
const load = (name: string, fallback: any) => fs.existsSync(path.join(output, name)) ? JSON.parse(fs.readFileSync(path.join(output, name), 'utf8')) : fallback;
const budget = load('budget.json', { authorization: '用户追加最多120次，使用当前默认模型；不含已用完的此前100次', authorized: 120, dispatched: 0, attempts: [] });
if (throughThirty && budget.targetChapters !== 30) {
  budget.authorizationHistory ??= [];
  budget.authorizationHistory.push({ authorization: budget.authorization, authorized: budget.authorized, throughCall: budget.dispatched });
  Object.assign(budget, { authorized: null, targetChapters: 30, authorization: '用户明确要求：直到30章结束，你可以一直调用，出了问题你自己修复。保留累计用量，中断自动重试。', extendedAt: new Date().toISOString() });
  save('budget.json', budget);
}
if (budget.authorized !== 120 && !(throughThirty && budget.authorized === null && budget.targetChapters === 30)) throw new Error('评测授权记录不匹配');
const targetChapters: number = budget.targetChapters ?? 20;
const withinBudget = () => budget.authorized === null || budget.dispatched < budget.authorized;
if (process.argv.includes('--auto-retry-interruptions') && !budget.autoRetryInterruptions) {
  budget.autoRetryInterruptions = { authorizedAt: new Date().toISOString(), instruction: '用户明确要求：中断你就自己重试。遵守当前评估目标及调用授权。' };
  save('budget.json', budget);
}
const state = load('state.json', { root: '', runId: '', rows: [], status: 'prepared' });
const auth = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyue-continuous-auth-'));
const originalSettings = path.join(app.getPath('appData'), 'wenxu-desktop');
const localState = path.join(originalSettings, 'Local State');
if (fs.existsSync(localState)) fs.copyFileSync(localState, path.join(auth, 'Local State'));
app.setPath('userData', auth);

const chapters = [
  ['桥封了，药没到', '阿宁带着修桥留下的左臂扭伤到诊所，发现自己的领药单被登记成已领取；他要求核对签收原件，留下单据，不给任何人定罪。', '推进'],
  ['这签名不是我的', '沈遥和阿宁一起核对签收联，发现日期早一天；阿宁放弃直接吵架，去找负责运输的周叔。左臂仍受伤。', '强冲突'],
  ['先把这碗面吃了', '周叔正在给滞留乘客煮面。阿宁帮忙分碗而不搬重物，得到周叔愿意查车次的承诺；快乐日常不强加惨案。', '日常'],
  ['雨棚下面有辆空车', '三人到停运车场查单据，风雨和停电造成压迫感。空车不是凶案现场；阿宁用职业常识安全照明，发现封条编号不符。', '推进'],
  ['别伸那只手', '雨棚滑落威胁周叔，阿宁选择用绳固定而非伤臂硬扛，沈遥指挥避让。救人成功但浸湿一联单据，付出真实代价。', '强冲突'],
  ['把湿纸摊开', '冷距离叙述三人烘干、拍照和编号单据。获得部分可读批号，仍不确定运输方是否知情，不替未知人物写内心。', '结算'],
  ['走小路，多半小时', '简洁过渡到临时仓库。周叔误信旧通知以为仓库关闭，看到当日值班表后承认误会，不把他的旧信念写成客观事实。', '转场'],
  ['先别喊抓贼', '阿宁面对陌生值班员控制急躁，以编号而非指控请求核对；值班员陈岚因手续拒绝直接交出原件，允许看公开交接记录。', '强冲突'],
  ['他们也在等药', '等候时遇见同样缺货的居民，了解不同需求。不给每人增添悲惨秘密；确认另一批物资延误，冲突扩为公共问题。', '日常'],
  ['缺的不是一箱', '交接数量表揭示整批短缺。陈岚主动签署差异说明，但不承认并不存在的盗窃；主角策略从追个人签名转为核对批次。', '结算'],
  ['这回我来搬', '经过合理休养沈遥检查确认阿宁左臂可做轻活，尚不能满负荷。阿宁帮助周叔整理散箱，关系中的语气区别于对陌生值班员。', '日常'],
  ['两张单，都是真的', '发现相同编号用了不同计量单位，单据并非全假。新难题来自多方各自正确的记录；阿宁不能仅靠拍桌解决。', '推进'],
  ['谁肯签这一行', '各方害怕担责，不愿确认差异。阿宁先公开自己的修桥记录承担自身错误，换取陈岚提出联合核验方法。', '强冲突'],
  ['别再把门锁上', '再到车场，回响第四章的雨棚与锁门场景。此次主动留门、准备照明和同伴分工，不能重复同一场惊吓。', '推进'],
  ['最后一班船', '道路仍未通，周叔提出水路运送应急药。天气窗口有限，三人舍弃非急需物品换空间，损失有选择依据。', '强冲突'],
  ['这一箱先给诊所', '物资到达后分配发生分歧，沈遥按公开的急需标准解释取舍；阿宁支持把自己的非紧急用量后置，不靠虚假全员欢呼。', '结算'],
  ['修好后，试着抬一下', '时间推进至伤势可恢复的节点，由复查明确阿宁左臂痊愈；他先试轻负重再参与工作，旧伤历史保留。', '日常'],
  ['把账贴在门口', '公开可核验的数量差异和纠正进度，隐去个人隐私。未知责任保持待调查，读者获得实际解决成果而非空泛正义宣言。', '推进'],
  ['这次不走旧桥', '新的运输需求出现，三人采用已验证的联合核验与备用路线，有意复用方法但改变分工和资源约束，体现前章改变。', '推进'],
  ['我签收到的是这些', '阿宁本人签收，回收第一章假签名与数量承诺；诊所恢复最低供应，修桥仍待正式验收，阶段闭环并留下可持续事业方向。', '结算']
] as const;

const extensionChapters = [
  ['桥头又排起了队', '最低供药恢复后居民提出农货和维修件运输需求；阿宁拒绝未经验收通旧桥，提出试行登记和限量接驳，运力矛盾由前章合作成果产生。', '推进'],
  ['今天不许谈账', '几人一起吃一顿迟到的庆功饭，沈遥不愿每句话都变成工作；阿宁学会停一停。快乐和关系本身成立，饭后各自决定愿意承担的班次，不硬插阴谋。', '日常'],
  ['你答应的是送到门口', '周叔按旧习惯理解交接止于码头，居民按承诺理解到家；各方并非恶意。阿宁承认含糊措辞造成误会，分清运输和末段送达责任。', '强冲突'],
  ['先修他们那条坡道', '阿宁已痊愈但工时有限，在自己的有偿维修与老人不能通行的坡道间作取舍；与委托人协商延期而非无代价兼顾，沈遥理解他的选择但不代替他承诺。', '推进'],
  ['这趟船不能空着回', '回程运力可送农货，来回时间却可能耽误医用补货；陈岚用已确认的交接记录参与设计小规模试运，保留失败余量，不再重复假单谜题。', '推进'],
  ['少收的那一笔', '冷距离记录一次试运的工时和支出；为解决急需而少收费用确实造成缺口。阿宁公开差额与边界，不用一次善举宣布经营已成功。', '结算'],
  ['这回别替我答应', '周叔热心替阿宁答应加班，阿宁对熟人明确拒绝；两人争执后约定接单前询问本人，关系有摩擦而不自动变为敌对。', '强冲突'],
  ['雨来了，按新的来', '再次暴雨预报，有意回响车场救人；本次预先检查、减载、停运阈值和通知生效。高潮在及时取消一趟并承担赔付，避免重复突发坍塌救人。', '强冲突'],
  ['账上还有一个空格', '核对承诺履行和试运营结果，列出仍未解决的桥梁验收与运力问题；向有损失的人说明补偿，接受并非人人满意，不把未知责任写成已定案。', '结算'],
  ['明早第一班，我来', '形成有限、可执行的排班与交接约定，阿宁主动承担自己能做的一班；回收签名、受伤、信任和承诺的变化，结束本段而非宣称社区所有问题解决。', '结算']
] as const;

async function extendEvaluation(service: Service) {
  if (targetChapters !== 30 || state.extensionInstalled || state.runId) return;
  const store = service.store!;
  if (path.dirname(path.resolve(store.root)) !== output) throw new Error('只能扩展隔离评估作品');
  const p = store.db.project();
  if (p.finished) throw new Error('必须在原计划完成前扩展评估目标');
  if (p.config.targetWords !== 75000) await service.invoke('project.configure', { config: { ...p.config, targetWords: 75000 } });
  const current = store.readAccepted(paths.volumes);
  const marker = '## 第二卷：明早第一班，我来';
  if (!current.content.includes(marker)) {
    const content = current.content.trimEnd() + `\n| 2 | 明早第一班，我来 | 21—30 | 10 | 25000 | 第2批 | 从临时互助到有边界的协作，承担取舍并兑现承诺 |\n\n${marker}\n\n- 章节范围：21—30\n- 预计章数：10\n- 预计字数：25000\n- 对应细纲批次：第21—30章\n- 主角阶段目标：将临时互助变成有边界的运输与维修协作。\n- 开局事件：最低供药恢复后出现新的日常运力需求。\n- 中段升级：承诺含糊、工时和回程空间有限，合作需要承担真实取舍。\n- 高潮事件：暴雨再来时按已建立的方法主动停运并承担损失。\n- 卷尾钩子：约定可执行的下一班，桥梁验收和长期运力仍待解决。\n- 新增人物与规则：无必须新增的主要人物；现实规则保持。\n- 规划边界：以下均为未来计划，实际正文与已确认状态优先；不把痊愈改回受伤，不重复假单谜题。\n\n` + extensionChapters.map(([title, event, type], index) => `### 第${index + 21}章：${title}\n- 类型：${type}\n- 计划：${event}`).join('\n\n') + '\n';
    const runId = state.extensionRunId ?? await service.invoke('document.save', { path: paths.volumes, content, baseHash: current.hash });
    state.extensionRunId = runId; save('state.json', state);
    const candidate = store.db.run(runId);
    candidate.continuity = { mode: 'forward', fromChapter: 21 };
    store.db.saveRun(candidate);
    await service.invoke('run.accept', { id: runId, proposalHash: proposalHash(candidate), startNext: false,
      warningReason: '按用户30章评估目标扩展未来规划，保留前20章及全部正式事实。' });
  }
  state.extensionInstalled = { at: new Date().toISOString(), afterCall: budget.dispatched, oldTarget: 20, target: 30,
    currentChapter: store.db.project().chapter, batches: store.db.project().batches,
    note: '保留已批准1—20章批次；21—30章到达后使用正常S06、S07、S08、S09、S10。新增章节方向属于评估输入，不是真人文学反馈。' };
  save('extension-input.json', { chapters: extensionChapters, ...state.extensionInstalled });
  save('state.json', state);
}

async function correctExtensionScope(service: Service) {
  if (!process.argv.includes('--correct-extension-scope') || state.extensionScopeCorrected) return;
  const store = service.store!;
  if (path.dirname(path.resolve(store.root)) !== output || !state.extensionRunId || !state.extensionInstalled)
    throw new Error('只能修复已记录的隔离评估扩展范围');
  const extension = store.db.run(state.extensionRunId), before = store.db.snapshot(extension.baseSnapshotId!);
  const current = store.db.project();
  if (!extension.accepted || current.chapter !== state.extensionInstalled.currentChapter || current.chapter > 20)
    throw new Error('扩展之后已有正文推进，不能自动修复范围');
  const metadata = new Set<string>([paths.volumes, paths.progress, paths.index, paths.impact]);
  const verified: { path: string; hash: string }[] = [];
  for (const document of store.db.acceptedDocuments()) {
    if (metadata.has(document.path)) continue;
    if (before.documents[document.path] !== document.hash) throw new Error(`扩展之后正式资料发生变化：${document.path}`);
    verified.push({ path: document.path, hash: document.hash! });
  }
  const oldVolume = store.object(before.documents[paths.volumes]).toString('utf8');
  const newVolume = store.readAccepted(paths.volumes);
  if (!newVolume.content.startsWith(oldVolume.trimEnd()) || !newVolume.content.includes('## 第二卷：明早第一班，我来'))
    throw new Error('扩展不再是保留原文的后续追加');
  if (state.runId) {
    const pending = store.db.run(state.runId);
    if (!pending.memoryRepair || pending.accepted || pending.status === 'running') throw new Error('当前任务还不能安全结束');
    await service.invoke('run.discard', { id: pending.id });
    save(`superseded-scope-run-${pending.id}.json`, store.db.run(pending.id));
  }
  const next = structuredClone(current);
  next.chapters = structuredClone(before.project.chapters);
  next.chapterStatesBeforeReview = structuredClone(before.project.chapterStatesBeforeReview);
  next.storyImpacts = structuredClone(before.project.storyImpacts ?? []);
  const change = { path: paths.volumes, baseHash: before.documents[paths.volumes], content: newVolume.content };
  const targets = futurePlanTargets(store, 21, [paths.volumes], [], [paths.volumes], initialFiles(next, path.resolve('resources/skill'), ''));
  next.stale = [...new Set([...before.project.stale, ...targets.map(target => target.path)])];
  next.revision++;
  if (targets.length) next.storyImpacts.push(makeStoryImpact(next, extension, [change], [], targets, { mode: 'forward', fromChapter: 21 }));
  const record = `\n\n## 评估输入范围修正\n\n仅新增第21—30章计划；此前原文及已采纳事实版本经本地哈希比对保持原样。撤销评估脚本误用追溯模式造成的待核对标记，不采纳错误范围任务中的候选。其请求、费用、候选和审核记录保留。\n- 原扩展任务：${extension.id}\n- 后续待核对：${targets.map(target => target.path).join('、') || '无'}\n`;
  new ProjectCommitService(store).commit([service.change(paths.impact, store.readAccepted(paths.impact).content + record), service.change(paths.progress, renderProgress(next))], next);
  const actual = new Map(store.db.facts().map(fact => [fact.id, fact]));
  for (const fact of before.facts) if (JSON.stringify(actual.get(fact.id)) !== JSON.stringify(fact)) throw new Error(`恢复范围后事实与原采纳版不一致：${fact.id}`);
  state.extensionScopeCorrected = { at: new Date().toISOString(), afterCall: budget.dispatched, extensionId: extension.id,
    discardedRunId: state.runId, beforeSnapshot: before.id, snapshot: store.db.headRef()!.id, verifiedDocuments: verified,
    scope: { mode: 'forward', fromChapter: 21 }, pendingPaths: next.stale, restoredFacts: before.facts.length };
  state.runId = ''; state.status = 'running'; delete state.reason;
  save('extension-scope-correction.json', state.extensionScopeCorrected); save('state.json', state);
}

function seed(service: Service) {
  const store = service.store!, p = store.db.project(), b = activeBatch(p), t = templates(path.resolve('resources/skill'));
  const fill = (text: string) => text.replace(/：\s*$/gm, '：围绕受伤维修工核对灾后药品签收差异，靠证据、协作和主动取舍推进。').replaceAll('：/5', '：3/5');
  const docs = new Map<string, string>();
  docs.set(paths.seed, fill(t['设定拆解']) + '\n\n阿宁是返乡维修工，左臂在修桥时扭伤。沈遥是社区诊所医生，周叔是接驳司机，陈岚是临时仓库值班员。无超能力、复活、隐藏血统和预设恶人。数量差异来自交接单位不一致及延误，不让人物提前知道原因。');
  docs.set(paths.config, renderConfig(p));
  docs.set(paths.style, '# 文风样本与规则\n\n- 状态：已启用\n- 文风来源：作者明确要求\n- 文风：清楚利落，有功能的日常与幽默；关键选择写足。\n- 叙述：第三人称限知，以阿宁为焦点，必要段落可采用冷距离。对白随关系变化，不堆心理解释、微动作与比喻。\n');
  const world = readWorldModel(store);
  world.modules = world.modules.map(module => module.id === 'world-foundation' ? { ...module, state: 'enabled', content: '现实社区遭受暴雨与道路中断，普通医疗、运输与行政程序仍有效。没有超能力体系。重要结论必须有实物、记录或直接见证，人物可以误信旧通知。' } : module);
  docs.set(paths.world, renderWorldModel(world));
  docs.set(paths.roles, '# 角色卡\n\n' + [
    ['阿宁','CH01','返乡维修工','想把活做扎实，避免自己的疏忽拖累别人','查清签收差异并处理左臂扭伤','熟悉工具和安全操作，急时说话直，对熟人肯开玩笑'],
    ['沈遥','CH02','社区诊所医生','希望有限资源确实到需要的人手里','维持诊所供应并按证据诊治','简短准确，对不实保证会直接追问'],
    ['周叔','CH03','接驳司机','维持大家彼此靠得住的体面','查清自己运输环节的记录','爱把正事藏在家常话里，仍愿意承认记错'],
    ['陈岚','CH04','临时仓库值班员','想把流程做清楚而不替未知责任背书','完成可核验交接','对陌生人先讲条件，得到具体依据后愿意协作']
  ].map(([name,id,identity,desire,goal,voice]) => `## ${name}\n\n- 标识：${id}\n- 重要度：主要\n- 剧情功能：通过自身选择改变事件\n- 首次出场：待正文确认\n- 当前身份：${identity}\n- 所属阵营：社区居民\n- 外显人设：务实\n- 深层欲望：${desire}\n- 当前目标：${goal}\n- 最大恐惧：没有确认\n- 做事风格：${voice}\n- 说话风格：${voice}\n- 情绪底色：克制\n- 当前心情：未知\n- 心情来源：尚无正文\n- 对主角态度：按实际互动形成\n- 秘密：未设定\n- 弱点：信息有限\n- 爽点用途：主动选择得到可兑现的进展\n- 后续可用冲突：目标与手续、资源的矛盾`).join('\n\n'));
  docs.set(paths.relations, '# 人物关系\n\n| 角色A | 角色B | 关系标签 | 极性 | 信任度0-100 | 冲突点 | 当前状态 | 未来变化方向 |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n');
  for (const file of [paths.behavior, paths.summary, paths.timeline, paths.hooks, paths.items, paths.terms, paths.knowledge]) docs.set(file, '# ' + path.basename(file, '.md') + '\n\n尚无正文发生记录，不把下列规划写成已发生事实。\n');
  docs.set(paths.volumes, fill(t['分卷大纲']) + '\n| 1 | 桥封了，药没到 | 1—20 | 20 | 50000 | 第1批 | 阿宁从为自己查单据到促成联合核验，诊所恢复最低供应，形成长期合作 |\n');
  docs.set(paths.outline, t['章节总纲'] + '\n' + chapters.map(([title, event, type], index) => `| 第${index + 1}章 | ${type} | 3 | 承接前章实际结果 | ${title} | ${event} | 主动核验与选择 | 信息与资源不足 | 本章明确选择 | 真实取舍 | 证据变化 | 按处境变化 | 次章具体行动 |`).join('\n'));
  docs.set(rhythmPath(b), t['第001-030章节奏'] + '\n| 第1—20章 | 推进3→日常2→强冲突4→结算2 | 供药差异 | 核验 | 信息与资源 | 可核验进展 | 日常与余波 | 承担取舍 | 联合交接 |\n');
  docs.set(batchPath(b), '# 批量细纲\n\n' + ['批次范围','依据文件','当前卷','批次主目标','批次结束钩子','本批设定揭示总量','本批禁止提前揭示','本批强度曲线','本批重复结构检查','对应章节总纲范围已扩展','对应三十章节奏文件'].map(field => `- ${field}：${field === '对应章节总纲范围已扩展' ? '是' : '第1—20章，从签收疑点到联合核验；不提前知道交接单位差异，按总纲逐章兑现。'}`).join('\n') + '\n\n' + chapters.map(([title,event,type], index) => `## 第${index+1}章：${title}\n\n- 承接：继承前章实际人物、物品与信息状态\n- 章节类型：${type}\n- 情节强度：3/5\n- 前300字叙事入口：进入本章具体行动，不重述全书前提\n- 核心场面：${event}\n- 主角动作：由本章事件决定主动选择\n- 外部推动：既有选择引起回应\n- 状态变化：${event}\n- 设定揭示预算：仅使用本章事件能支持的信息\n- 主要阅读回报：局面或理解有所推进\n- 人物记忆变化：只根据最终正文更新\n- 章末牵引：完成本章行动，保留下一步具体目标`).join('\n\n'));
  for (const stage of ['S01','S02','S03','S04','S05','S06','S07','S08'] as const) {
    const current = store.db.project();
    store.commit(stageOutputs(stage, current).map(file => service.change(file, docs.get(file)!)), current);
  }
  const ready = store.db.project(); ready.stage = 'S09'; store.db.set('project', ready);
  save('prepared-input.json', { chapters, documents: Object.fromEntries(docs), humanFeedback: null, scope: '作者预先提供设定与二十章计划；S09起全部使用真实默认流程' });
}

async function main() {
  await app.whenReady();
  const settings = JSON.parse(fs.readFileSync(path.join(originalSettings, 'settings.json'), 'utf8'));
  const sourceDb = new DatabaseSync(path.join(settings.recent[0].root, '.novelclient/state.sqlite'), { readOnly: true });
  let defaultId: string;
  try { defaultId = JSON.parse(String(sourceDb.prepare('SELECT value FROM kv WHERE key=?').get('project')!.value)).config.defaultProfileId; }
  finally { sourceDb.close(); }
  const configured = settings.profiles.find((profile: SecretProfile) => profile.id === defaultId);
  if (!configured?.enabled || !configured.encryptedKey) throw new Error('当前默认模型不可用');
  const { encryptedKey, ...publicProfile } = configured;
  const profile: SecretProfile = { ...publicProfile, apiKey: safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')) };
  if (budget.profileId && (budget.profileId !== profile.id || budget.model !== profile.model)) throw new Error('评测模型变化，停止混合比较');
  Object.assign(budget, { profileId: profile.id, model: profile.model }); save('budget.json', budget);
  save('configuration.json', { model: profile.model, profileId: profile.id, outputLimit: profile.outputLimit, contextLimit: profile.contextLimit, protocol: profile.protocol,
    currency: profile.currency, inputPrice: profile.inputPrice, outputPrice: profile.outputPrice, pricesAreConfiguredEstimates: true, maxCalls: budget.authorized, targetChapters, targetWords: 2500, humanFeedback: null });
  let service: Service;
  service = new Service(path.resolve('resources/skill'), () => {}, async (...args) => {
    if (!withinBudget()) throw new RequestError('当前评估调用额度已用完，请求尚未发送', false);
    const ordinal = ++budget.dispatched;
    const row: any = { ordinal, startedAt: new Date().toISOString(), status: 'dispatched', requestHash: hash(JSON.stringify({ system: args[1], messages: args[2], tools: args[3] })) };
    budget.attempts.push(row); save('budget.json', budget);
    save(`request-${ordinal}.json`, { system: args[1], messages: args[2], tools: args[3] });
    save(`wire-request-${ordinal}.json`, requestBody(args[0], args[1], args[2], args[0].tools ? args[3] : [], args[6]).body);
    try {
      const response = await invokeModel(...args);
      const active = service.store?.db.runs().find(run => run.status === 'running');
      if (active?.pipeline?.phase === 'prose' && !args[3].length && response.stop === 'complete' && !response.calls.length) {
        const complete = path.join(output, `chapter-${active.chapter}-first-complete.md`);
        if (!fs.existsSync(complete)) atomicWrite(complete, decodeNarrativeResponse(response.text).text);
        const first = path.join(output, `chapter-${active.chapter}-first.md`);
        if (!fs.existsSync(first)) atomicWrite(first, decodeNarrativeResponse(response.text).text);
      }
      Object.assign(row, { status: 'complete', endedAt: new Date().toISOString(), usage: response.usage });
      save(`response-${ordinal}.json`, response); save('budget.json', budget);
      return response;
    } catch (error) { Object.assign(row, { status: 'failed_or_unknown', error: (error as Error).name }); save('budget.json', budget); throw error; }
  });
  service.profiles = [profile];
  try {
    if (state.root) await service.invoke('project.open', { root: state.root });
    else {
      await service.invoke('project.create', { parent: output, title: '签收人不是我·连续评估', premise: '返乡维修工阿宁发现自己的药品被他人签收，追查运输单据时遇到灾后供药缺口，以职业经验、协作和主动取舍推动事情改变。现实悬疑日常，无超能力。', config: { defaultProfileId: profile.id, targetWords: 50000, chapterWords: 2500, minWords: 2300, maxWords: 2700, maxRounds: 12, preview: { enabled: false } } });
      seed(service); state.root = service.store!.root; save('state.json', state);
    }
    const store = service.store!;
    await correctExtensionScope(service);
    if (state.runId && process.argv.includes('--repair-eval-metadata')) {
      if (path.dirname(path.resolve(store.root)) !== output) throw new Error('只能修改隔离评估作品');
      const run = store.db.run(state.runId);
      state.authorEdits ??= [];
      for (const change of run.changes) {
        let content = change.content;
        if (change.path === paths.relations) content = content.replaceAll('| 未量化 |', '| 未评估 |');
        if (change.path === updatePath(run.chapter)) {
          const prose = run.changes.find(c => c.path === prosePath(run.chapter));
          if (prose) content = content.replace(/^- 正文实际字数：.*$/m, `- 正文实际字数：${countWords(prose.content)}（宿主按正文非空白 Unicode 码点计数，不含章节标题）。`);
        }
        if (content !== change.content) {
          await service.invoke('run.update', { id: run.id, path: change.path, content });
          state.authorEdits.push({ runId: run.id, path: change.path, beforeHash: hash(change.content), afterHash: hash(content),
            reason: '只规范未知信任度及宿主可复算的统计说明；不改正文、事实或审核结论。', at: new Date().toISOString() });
        }
      }
      const p = store.db.project();
      if (p.config.maxRounds < 24) {
        await service.invoke('project.configure', { config: { ...p.config, maxRounds: 24 } });
        state.authorEdits.push({ runId: run.id, reason: '隔离评估任务轮数从12提高到24，累计请求、工具、费用、自动修复次数与120次总授权均保留。', at: new Date().toISOString() });
      }
      save('state.json', state);
    }
    const retryFlags = process.argv.filter(value => /^--retry-unknown-\d+$/.test(value));
    if (retryFlags.length > 1) throw new Error('一次只能使用一项明确的未知请求重试授权');
    const retryInterrupted = async (ordinal: number, automatic = false) => {
      if (!withinBudget()) throw new Error('已达到当前调用上限，不能继续重试');
      if (automatic && !budget.autoRetryInterruptions) throw new Error('缺少自动重试授权');
      const interrupted = budget.attempts.find((row: any) => row.ordinal === ordinal);
      if (!interrupted || !['failed_or_unknown', 'dispatched'].includes(interrupted.status) || interrupted.retryAuthorizedAt)
        throw new Error('这次未知请求的重试授权不存在或已经使用');
      const unknown = attempts(store, state.runId).filter(attempt => attempt.status === 'unknown' && !store.db.get(`unknown-retry-authorized:${attempt.id}`));
      if (unknown.length !== 1 || Math.abs(Date.parse(unknown[0].createdAt) - Date.parse(interrupted.startedAt)) > 5000)
        throw new Error('待恢复请求与本次明确授权的序号不一致');
      interrupted.retryAuthorizedAt = new Date().toISOString();
      interrupted.retryAuthorization = automatic ? `按用户中断自动重试授权恢复第${ordinal}次请求，累计用量保留，目标${targetChapters}章`
        : `用户明确授权重试第${ordinal}次未知请求，累计用量保留`;
      save('budget.json', budget);
      state.runId = await service.invoke('run.resume', { id: state.runId, retryUnknown: true });
      state.status = 'running'; delete state.reason; save('state.json', state);
    };
    if (state.runId && retryFlags.length) {
      await retryInterrupted(Number(retryFlags[0].slice('--retry-unknown-'.length)));
    }
    if (state.runId && process.argv.includes('--resume-known')) {
      state.runId = await service.invoke('run.resume', { id: state.runId });
      state.status = 'running'; delete state.reason; save('state.json', state);
    }
    const answerFile = process.argv.find(value => value.startsWith('--answer-file='))?.slice('--answer-file='.length);
    if (state.runId && answerFile) {
      const answer = fs.readFileSync(path.resolve(answerFile), 'utf8');
      state.runId = await service.invoke('run.answer', { id: state.runId, answer });
      (state.evaluationInterventions ??= []).push({ runId: state.runId, answer, at: new Date().toISOString() });
      state.status = 'running'; delete state.reason; save('state.json', state);
    }
    const completedChapters = () => new Set(state.rows.filter((row: any) => row.accepted && row.proseHash).map((row: any) => row.chapter)).size;
    while (completedChapters() < targetChapters && withinBudget()) {
      await extendEvaluation(service);
      if (!state.runId) {
        const p = store.db.project();
        const request = p.stage === 'S09' ? '按已确认本章计划生成任务清单与细纲。' : p.stage === 'S10'
          ? '生成本章正文，承接已经发生的状态，按正常流程完成审阅与记忆。'
          : '按分卷大纲中已确认的第21—30章规划完成当前阶段，承接前20章实际结果，保留已有原文及确定章名。只输出本阶段合同要求的材料。';
        state.runId = await service.invoke('run.start', { request });
        save('state.json', state);
      }
      while (service.runner!.controller) await new Promise(resolve => setTimeout(resolve, 250));
      let run: Run = store.db.run(state.runId);
      const prose = run.changes.find(change => change.path === prosePath(run.chapter));
      if (prose) {
        if (run.status === 'unknown' && run.pipeline?.phase === 'prose') {
          const partial = path.join(output, `chapter-${run.chapter}-interrupted-${budget.dispatched}.md`);
          if (!fs.existsSync(partial)) atomicWrite(partial, prose.content);
        }
        atomicWrite(path.join(output, `chapter-${run.chapter}-candidate.md`), prose.content);
      }
      save(`run-${run.id}.json`, run);
      if (run.status === 'unknown' && budget.autoRetryInterruptions && withinBudget()) {
        const interrupted = budget.attempts.at(-1);
        const consecutive = [...budget.attempts].reverse().findIndex((row: any) => row.status === 'complete');
        await new Promise(resolve => setTimeout(resolve, Math.min(30000, 3000 * Math.max(1, consecutive === -1 ? budget.attempts.length : consecutive))));
        await retryInterrupted(interrupted.ordinal, true);
        continue;
      }
      if (run.status !== 'awaiting_review' || run.issues.some(issue => issue.severity === 'error')) {
        state.status = 'blocked'; state.reason = run.error ?? run.issues.filter(issue => issue.severity === 'error').map(issue => issue.message).join('；');
        save('state.json', state); break;
      }
      await service.invoke('run.accept', { id: run.id, proposalHash: proposalHash(run), startNext: false,
        warningReason: '隔离研发评估采纳有效候选；文学建议保留待作者与读者评估，不将模型判断视为真人反馈。' });
      run = store.db.run(run.id);
      state.rows.push({ runId: run.id, chapter: run.chapter, stage: run.stage, accepted: true, usage: run.usage, calls: attempts(store, run.id).length,
        words: prose ? countWords(prose.content) : null, proseHash: prose ? hash(prose.content) : null, status: run.status, snapshot: store.db.headRef()!.id });
      if (prose) atomicWrite(path.join(output, `chapter-${run.chapter}-final.md`), store.readAccepted(prosePath(run.chapter)).content);
      state.runId = ''; state.status = 'running'; save('state.json', state);
      if (fs.existsSync(path.join(output, 'pause-after-stage.json'))) { state.status = 'paused_between_stages'; break; }
    }
    if (completedChapters() >= targetChapters) state.status = 'complete';
    else if (!withinBudget()) state.status = 'budget_exhausted';
    save('state.json', state);
    save('report.json', { ...state, realCalls: budget.dispatched, sourceModel: profile.model, humanQualityVerified: false,
      usage: budget.attempts.map((row: any) => row.usage), authorEdits: state.authorEdits ?? [], readerDropoff: null,
      note: '保留完整请求与候选，缺失的真人反馈为未知；没有绕过审核、伪造采纳或重置额度。' });
  } finally { await service.drain(); }
}
main().catch(error => { save('fatal.json', { name: error.name, message: error.message }); process.exitCode = 1; }).finally(() => app.quit());
