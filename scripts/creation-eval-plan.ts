import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { countInput } from '../src/core/context-budget';
import { profileSchema } from '../src/shared/types';

export const firstDraftCases = [
  { id: 'horror', function: '恐怖环境', setup: '停电后的档案室只有应急灯。维修员阿宁知道楼里还有值班员，但不知道走廊脚步是谁。她要取回维修记录。', result: '找到记录，发现门从外面被推住，尚未识别来人。', protect: '不新增鬼怪、童年创伤或幕后真相。' },
  { id: 'joy', function: '快乐日常', setup: '邻居一起给社区厨房换灯。阿宁期待晚上能让母亲看清菜单，母亲想留下大家吃饭。', result: '灯亮了，众人商定一人带一道菜。', protect: '不强加反转灾难、阴谋、沉重创伤或无关道具。' },
  { id: 'action', function: '高强度行动', setup: '暴雨冲进地下泵房。阿宁熟悉旧水泵，医生赵宁只知道配电箱在哪。断电后有一分钟能关阀。', result: '两人关阀，丢失一箱工具，撤离后仍须处理被淹的诊所。', protect: '没有超能力、不突然增加第三名救援者、不免除工具损失。' },
  { id: 'cold', function: '冷距离叙述', setup: '修理站公布裁撤名单。阿宁留任，师傅离开。叙述保持克制和远距离，人物不当众表态。', result: '师傅交还钥匙，阿宁接过未修完的工单。', protect: '保留冷叙述，不强制每段写心理或微动作。' },
  { id: 'transition', function: '直接过渡', setup: '上午已经约定下午到诊所核对收据。路程没有障碍，重要交锋发生在到达以后。', result: '压缩路途，到达后阿宁提出核对日期，医生同意取账本。', protect: '不把过渡写成险境或每处景物都比喻化。' },
  { id: 'relationships', function: '同一人物面对不同关系', setup: '阿宁需要借二百元。她面对母亲不想让对方担心，面对熟悉的医生则愿意直接谈还款时间。', result: '她没有向母亲借钱，与医生谈成分期；仍需自己承担还款。', protect: '保持同一人的务实性，不靠固定口头禅区分关系。' },
  { id: 'belief', function: '错误信念', setup: '阿宁相信旧桥仍通行。作者已确认桥昨夜封闭，但她没有收到通知。医生只问她打算走哪条路。', result: '阿宁坚持先走旧桥，直到到桥头才看到封条。', protect: '桥头之前不得让阿宁知道封闭，更不能把她的错误信念记成客观事实。' },
  { id: 'echo', function: '有意回响', setup: '第一章阿宁拒绝在未看清内容时签字。现在修理站要她为已核实的安全记录签名。', result: '她再次要求看全记录，这次主动签字并承担责任。', protect: '保留签字动作的有意复现，改变选择与后果，不因重复意象自动判错。' },
  { id: 'metaphor', function: '比喻与事实边界', setup: '冬天的诊所里，阿宁紧张时觉得手像浸在冰水里。她没有接触冰水，也没有冻伤或冰系能力。', result: '她终于说明欠款原因，医生答应核账。', protect: '修辞不得被提取成接触冰水、冻伤或新能力；不禁止有功能的比喻。' }
];

const continuation = [
  '阿宁修泵伤到左臂，答应十天内交还借用工具。', '伤势限制用力，她改为指导赵宁操作，发现收据日期异常。',
  '医生确认左臂恢复，阿宁取回当日工单，仍不知道桥已封闭。', '到旧桥才发现封闭，绕路耗时，失去当日进库机会。',
  '向母亲隐瞒借款，向医生坦白日期疑点，取得复印件。', '同事提出偷换复印件，阿宁拒绝，决定正式申请查账。',
  '申请因缺签字被退回，她找到当班人核实时间。', '当班人记错时段，阿宁用交接记录纠正，双方互信增加。',
  '找回借用工具中缺的一把扳手，得知维修站将撤班。', '按约归还工具，保留一笔未偿清借款，工具承诺兑现。',
  '厨房换灯后的聚餐，快乐与普通生活保留，母亲察觉她欠钱。', '母女直接交谈，阿宁承担还款计划，关系紧张减轻。',
  '暴雨使泵房积水，阿宁和医生合作关阀但损失工具。', '诊所无法照常开门，两人向邻居借场地处理病人预约。',
  '阿宁提议共享工具，对手用排班规则反制，获得部分人支持。', '她修改分工条件，以减少个人使用时段换取共享通道。',
  '查账结果显示日期错误源于交接失误，尚无盗窃证据。', '阿宁公开更正此前怀疑，付出声誉代价并修复同事关系。',
  '师傅离职交还钥匙，她接过旧工单，采用冷距离叙述。', '她再次阅读安全记录后签字，首章签字问题形成有意回响。',
  '小组用新的交接流程完成一次检修，保留仍未解决的借款。', '回款后偿还部分借款，医生提出下一阶段合作条件。',
  '共享工具计划遇到不同地区规则，双方选择小范围试行。', '第一阶段落地，承诺与人物关系取得实质进展，留下明确下一阶段目标。'
];

export function prepareCreationEvaluation(output = '.test-output/creation-upgrade-20261030/evaluation') {
  fs.mkdirSync(output, { recursive: true });
  const oldBudgetFile = '.test-output/xingyue-v7/live-quality/budget.json';
  const oldBudget = fs.existsSync(oldBudgetFile) ? JSON.parse(fs.readFileSync(oldBudgetFile, 'utf8')) : null;
  let selected: ReturnType<typeof profileSchema.parse> | undefined;
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(process.env.APPDATA!, 'wenxu-desktop/settings.json'), 'utf8'));
    const db = new DatabaseSync(path.join(settings.recent[0].root, '.novelclient/state.sqlite'), { readOnly: true });
    let key: string;
    try { key = JSON.parse(String(db.prepare('SELECT value FROM kv WHERE key=?').get('project')!.value)).config.defaultProfileId; } finally { db.close(); }
    const saved = settings.profiles.find((p: { id: string }) => p.id === key);
    selected = saved ? profileSchema.parse(saved) : undefined;
  } catch { /* Pricing and model remain unknown when local configuration is unavailable. */ }
  const requestFile = '.test-output/creation-upgrade-20261030/requests/default-s09-s10-chapter.json';
  const requests = fs.existsSync(requestFile) ? JSON.parse(fs.readFileSync(requestFile, 'utf8')) as object[] : [];
  const sizes = selected ? requests.map(request => countInput(selected!, request)) : [];
  const perChapterInput = sizes.reduce((sum, size) => sum + size.tokens, 0);
  const perChapterOutputCap = selected ? selected.outputLimit * requests.length : null;
  const upperConfiguredCost = selected?.inputPrice != null && selected.outputPrice != null && perChapterOutputCap !== null
    ? (perChapterInput * selected.inputPrice + perChapterOutputCap * selected.outputPrice) / 1_000_000 : null;
  const record = {
    version: 1, preparedAt: new Date().toISOString(), baselineCommit: 'ea26db6e17e7b2e019266d20af3a1e3f7665410c',
    currentCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), currentWorkingChanges: true,
    model: selected ? { id: selected.id, name: selected.name, model: selected.model, version: selected.version, protocol: selected.protocol, temperature: selected.temperature, reasoningEffort: selected.reasoningEffort, inputPrice: selected.inputPrice, outputPrice: selected.outputPrice, currency: selected.currency } : null,
    budget: { authorized: oldBudget?.authorized ?? null, alreadyDispatched: oldBudget?.dispatched ?? null, remaining: oldBudget ? Math.max(0, oldBudget.authorized - oldBudget.dispatched) : null, newRealCalls: 0 },
    firstDraft: { cases: firstDraftCases, words: { target: 2500, min: 2300, max: 2700 }, repeats: 1,
      controls: ['同一模型版本、推理档位、温度和预算', '同一事实、人物、场景结果和正文目标长度', '首稿在任何修订前留存，最终稿另存', '随机匿名 A/B，真实作者改稿与模型意见分开'],
      outcomes: ['A', 'B', '相近', '都不好', '没读完'], metrics: ['作者实际改动', '动机清晰度', '声音辨识度', '重复解释', '无意义修辞', '继续阅读意愿'] },
    continuous: { chapters: continuation.map((goal, i) => ({ chapter: i + 1, targetWords: 2500, acceptedGoal: goal })), path: ['run.start S09', 'run.accept', 'run.start S10', '正文审核', '批量记忆提取', '独立记忆审核', 'run.accept', '下一章'],
      metrics: ['首稿与最终稿分别留存', '前章状态进入后章请求', '人物辨识度', '伏笔与承诺', '解法重复及有意回响', '作者改动量', '真实读者停止位置', '模型调用、耗时和费用'], authorEdits: null, humanReaderFeedback: null },
    estimate: { ordinaryCallsPerChapter: 5, continuous24BaseCalls: 120, controlledFirstDraftOnlyCalls: 18, allDefaultStagesFor9PairsCalls: 90,
      excluded: ['初始 S01—S08 建设', '格式修复', '业务修复', '可选实时评估', '逐场模式额外写作请求'],
      sampledStageInputTokens: sizes, sampledPerChapterInputTokens: perChapterInput || null, perChapterOutputCap, configuredPriceScenarioPerChapter: upperConfiguredCost,
      note: '按离线请求体、已配置单价与输出上限估算，不是实际账单；后章上下文会增长。无单价保持未知。' },
    execution: { firstDraftLive: 'not_executed_budget_exhausted', continuousLive: 'not_executed_budget_exhausted', realReaders: 'not_available', qualityImprovementProven: false }
  };
  fs.writeFileSync(path.join(output, 'inputs-and-budget.json'), JSON.stringify(record, null, 2));
  fs.writeFileSync(path.join(output, 'blind-feedback-template.json'), JSON.stringify(firstDraftCases.map(c => ({ caseId: c.id, participantId: null, origin: null, order: null, outcome: null, stoppedAt: null, motivation: null, distinctVoice: null, repeatedExplanation: null, meaninglessImagery: null, wantToContinue: null, authorBefore: null, authorAfter: null, reason: null })), null, 2));
  return { cases: firstDraftCases.length, continuousChapters: continuation.length, remainingCalls: record.budget.remaining, realCalls: 0, output };
}

if (process.argv.includes('--prepare')) console.log(JSON.stringify(prepareCreationEvaluation()));
