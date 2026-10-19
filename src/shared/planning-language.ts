import type { ContractCandidate, PlanningReport, TagKnowledge } from './tags';

export interface PlanningTextContext {
  report?: PlanningReport;
  knowledge?: Pick<TagKnowledge, 'options'>;
  candidate?: ContractCandidate;
  resolutions?: Record<string, string>;
}

const fieldNames: Record<string, string> = {
  mustKeep: '必须保留', mustAvoid: '不能出现', optionId: '标签编号', optionIds: '相关标签',
  assumptionIds: '相关假设', directionId: '方向编号', directionIds: '适用方向',
  selectedDirectionId: '所选方向', recommendedDirectionId: '推荐方向', entityIds: '适用人物或事物',
  fromChapter: '起始章节', toChapter: '结束章节', evidenceRef: '依据来源', scope: '适用范围',
  inputHash: '输入版本指纹', knowledgeVersion: '规则版本', authorConfirmed: '作者已确认',
  tagCoverage: '标签兑现计划', openQuestions: '开放问题', unresolvedQuestions: '待确认问题',
  premiseDocument: '设定拆解文稿', constraints: '创作约束', assumptions: '待确认假设',
  intentChanges: '对作者前提的调整', marketClaims: '市场判断', jsonPointer: '审核位置', severity: '问题级别',
  needs_confirmation: '待作者确认', blocker: '阻断问题', major: '重要问题', minor: '一般建议',
  registry_only: '仅有标签信息', genre_draft: '题材基线草案', detailed_draft: '详细知识草案'
};
const stageLabels: Record<string, string> = {
  S01: '设定拆解阶段', S02: '项目配置阶段', S03: '世界规则阶段', S04: '人物与记忆阶段',
  S05: '分卷大纲阶段', S06: '章节总纲阶段', S07: '批次节奏阶段', S08: '批量细纲阶段',
  S09: '单章规划阶段', S10: '正文阶段', S11: '章后更新阶段'
};
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tokenPattern = (tokens: string[], extra = '') => new RegExp(
  `(?<![A-Za-z0-9_.-])(?:${tokens.sort((a, b) => b.length - a.length).map(escape).join('|')}${extra})(?![A-Za-z0-9_.-])`, 'g'
);
const machineId = (value: string) => /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value) && /[_.-]|[A-Za-z]\d/.test(value);
const literalPattern = /https?:\/\/[^\s<>"'`，。；！？、（）]+|[A-Za-z]:[\\/][^\r\n<>"|，。；！？]+/g;
const emptyInputs = (value: string) => value.replace(/(?<![A-Za-z0-9_.-])["`']?(mustKeep|mustAvoid)["`']?\s*[=:：]\s*\[\s*\]/g, (_, key: string) => `${fieldNames[key]}：未填写`);
const readableParts = (value: string, change: (part: string) => string) => {
  let result = '', offset = 0;
  for (const match of value.matchAll(literalPattern)) {
    result += change(value.slice(offset, match.index)) + match[0];
    offset = match.index + match[0].length;
  }
  return result + change(value.slice(offset));
};
function referenceNames(context: PlanningTextContext) {
  const references = new Map<string, { short: string; detail?: string }>();
  const add = (id: string, short: string, detail?: string) => {
    if (machineId(id) && !references.has(id)) references.set(id, { short, detail });
  };
  context.knowledge?.options.forEach(option => add(option.id, option.label));
  context.report?.directions.forEach((direction, index) => add(direction.id, `方向${['一', '二', '三'][index] ?? index + 1}`, direction.title));
  context.report?.assumptions.forEach((assumption, index) => add(assumption.id, `假设${index + 1}`, assumption.text));
  context.candidate?.constraints.forEach((constraint, index) => add(constraint.id, `约束${index + 1}`));
  Object.keys(context.resolutions ?? {}).forEach((id, index) => add(id, `已处理假设${index + 1}`));
  return references;
}

export function createPlanningTextFormatter(context: PlanningTextContext = {}) {
  const references = referenceNames(context);
  const labels = new Map([...Object.entries(fieldNames), ...Object.entries(stageLabels)]);
  for (const [id, value] of references) labels.set(id, value.short);
  const pattern = tokenPattern([...labels.keys()]);
  const shortLabels = new Map(labels);
  for (const [id, value] of references) if (value.detail && value.detail !== value.short) {
    const detail = readableParts(value.detail, part => emptyInputs(part).replace(pattern, token => shortLabels.get(token)!));
    labels.set(id, `${value.short}「${detail}」`);
  }
  return (value: string) => readableParts(value, part => emptyInputs(part)
    .replace(pattern, token => labels.get(token)!)
    .replace(/实体\s*ID\b/gi, '实体编号'));
}

export function containsInternalPlanningText(value: string, context: PlanningTextContext = {}) {
  const pattern = tokenPattern([...Object.keys(fieldNames), ...Object.keys(stageLabels), ...referenceNames(context).keys()], '|A_[A-Z][A-Z0-9_]*|(?:reading|content)\\.[a-z]+\\.\\d+');
  let found = false;
  readableParts(value, part => { pattern.lastIndex = 0; found ||= pattern.test(part); return part; });
  return found;
}

export const planningLanguageRules = '面向作者的标题、说明、假设正文、约束正文、开放问题、审核解释和设定文稿必须用清晰自然的中文。结构化工具的字段名和编号仅供程序关联，必须保留在对应字段中，不能抄进这些正文。引用方向时写方向中文标题，引用假设时写具体设定内容，引用标签时写标签中文名称；不要让作者根据内部编号猜意思。作者约定用“必须保留”“不能出现”，空列表只表示“作者未填写”，不等于作者批准无限制。审核定位只放在审核位置字段，解释和修改建议写具体问题。可以保留作者指定的英文人名、作品名、必要缩写以及原样引用的链接，不要把所有英文字母一律删除。旧书的已接受设定文稿必须原样返回，不因语言规范自动重写。';
