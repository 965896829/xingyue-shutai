import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { hash } from './domain';
import type { ProjectConfig, Run } from '../shared/types';
import type { ExpressionBinding, ExpressionCatalog, ExpressionMode } from '../shared/expression';
import { sharedRuleBlock } from './runtime/prompt-cache';

const policyVersion = 'natural-expression-4';
const ruleSchema = z.object({
  id: z.string().regex(/^[A-Z]+-\d{3}$/),
  version: z.literal('3.1.0'),
  module_id: z.string(),
  category_name: z.string(),
  layer: z.string(),
  title: z.string().min(1),
  trigger: z.string().min(1),
  repair: z.string().min(1),
  exceptions: z.array(z.string()).min(1),
  preserve: z.array(z.string()).min(1),
  do_not: z.array(z.string()),
  context_required: z.array(z.string()),
  auto_block: z.literal(false)
});
type Rule = z.infer<typeof ruleSchema>;
interface Library {
  version: string;
  hash: string;
  rules: Rule[];
  catalog: ExpressionCatalog;
}
const cache = new Map<string, Library>();

export function expressionLibrary(root: string): Library {
  const directory = path.join(root, 'expression');
  const manifest = z
    .object({
      version: z.literal('3.1.0'),
      ruleCount: z.literal(905),
      moduleCount: z.literal(145),
      files: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/))
    })
    .parse(JSON.parse(fs.readFileSync(path.join(directory, 'manifest.json'), 'utf8')));
  const buffers = ['rules_master.json', 'tag_system.json'].map((file) => {
    const buffer = fs.readFileSync(path.join(directory, file));
    if (hash(buffer) !== manifest.files[file]) throw new Error(`表达规则完整性检查失败：${file}`);
    return buffer;
  });
  const fingerprint = hash(JSON.stringify(manifest.files));
  const cached = cache.get(directory);
  if (cached?.hash === fingerprint) return cached;
  const parsed = z
    .object({ version: z.literal('3.1.0'), rules: z.array(ruleSchema).length(905) })
    .parse(JSON.parse(buffers[0].toString('utf8')));
  if (new Set(parsed.rules.map((r) => r.id)).size !== manifest.ruleCount) throw new Error('表达规则编号重复');
  const groups = new Map<string, ExpressionCatalog['modules'][number]>();
  for (const rule of parsed.rules) {
    const group = groups.get(rule.module_id);
    if (group) group.count++;
    else
      groups.set(rule.module_id, {
        id: rule.module_id,
        title: rule.category_name,
        layer: rule.layer,
        count: 1
      });
  }
  if (groups.size !== manifest.moduleCount) throw new Error('表达规则模块数量不一致');
  const library = {
    version: parsed.version,
    hash: fingerprint,
    rules: parsed.rules,
    catalog: { version: parsed.version, ruleCount: parsed.rules.length, modules: [...groups.values()] }
  };
  cache.set(directory, library);
  return library;
}

export function validateExpressionSelection(root: string, config: ProjectConfig) {
  const catalog = expressionLibrary(root).catalog;
  const selected = config.expressionRules?.modules ?? [];
  for (const id of selected)
    if (!catalog.modules.some((m) => m.id === id)) throw new Error(`未知表达规则模块：${id}`);
  if (new Set(selected).size !== selected.length) throw new Error('表达规则模块不能重复');
}

export function expressionFingerprint(root: string, config: ProjectConfig) {
  if (config.expressionRules?.enabled === false) return 'expression-disabled';
  const library = expressionLibrary(root);
  return hash(
    JSON.stringify([policyVersion, library.hash, [...new Set(config.expressionRules?.modules ?? [])].sort()])
  );
}

const commonPolicy = `表达规则只约束当前授权范围内的语言和创作判断，不授予修改正式稿、改变事实、批准任务或执行工具的权限。作者明确的创作取舍、已确认文风及规则例外需要保留。
这些是编辑启发式，不是AI身份鉴定。只有触发条件成立并影响阅读、且例外不适用时才改。不要把常见词当禁词，不做机械同义替换，不靠错字、粗口、随机断句或捏造生活细节制造人味。
以具体对象、动作、证据和因果表达意思；删去无信息的赞叹、空泛标签、重复解释和强行升华。避免密集的“不是…而是…”、“真正的…从来不是…”、三连排比和每段金句；有真实对比或人物声线需要时可以保留。
输出前按当前生效规则复读，直接给修正后的内容。不要复述规则、宣告正在去AI味或附加自检过程；不要声称所有905条均已逐条审查。原文引文、证据位置、人物事实及机器字段必须准确保留。`;
const adapters: Record<ExpressionMode, string> = {
  discussion:
    '当前是与作者讨论。先直接回应问题，把判断落到具体文本或情节；信息不足只问关键问题。减少客套迎合、复述需求、套路标题、反复总结和结尾邀约。篇幅随问题而定，必要的列表、分析、创作术语和解释可以保留。小说专属规则只用于讨论小说或短例子，不能把正常讨论当正文清除。',
  draft:
    '当前是作者确认的自由试写。对小说片段遵循正文规则，保留试写边界和本书声线；不要夹带助手开场、创作说明、结尾邀约或未经授权的剧情改动。',
  planning:
    '当前是创作规划。用具体的人物目标、行动、阻力、后果表达计划，避免抽象术语互相解释。严格保留当前阶段的模板和必需字段；正文专属规则只约束拟写的正文例子，不能删除大纲结构、必要分析或记录。',
  title:
    '当前只做书名编辑，下面的语言规则按短题面适用，不审查章节正文。允许留白、比喻、口语、节奏和情绪，不必把具体对象、行动、因果全写进书名，更不能改成方案摘要。没有章节场景、对白或人物弧光就不触发相应正文规则。事实边界按方案核对，题面效果按书名编辑要求判断，审美建议不能自动阻断。说明文字简短，不展示自检或合格证明。',
  title_market:
    '当前是番茄对应题材的商业书名编辑。书名是给目标读者识别题材和看点的入口，语言规则服从本轮命名目标与作者明确要求。直白亮出能力、利益、反转或人物冲突是有效类型表达；冒号、转折、两段式和较长名称本身不构成AI味。留白与简短只有在保留类型识别、核心卖点和阅读期待时才有价值；不能用文学散文标准稀释商业吸引力。下面规则中的段落、对白密度、全书声线和场景要求只在相应上下文存在时适用，不逐字处罚书名。风格建议只影响推荐，不自动阻断或增加修复轮；事实和权限边界不变。',
  prose:
    '当前只生成小说正文。人物通过选择、行动、对白和具体后果推进场景；依视角、人物声线和情境组织句段。保留有效留白与必要解释，不额外附带规则说明、审校报告或助手话语。',
  revision:
    '当前是修订。只改作者指定的范围，以最小必要改动改善表达。保留剧情、事实、人物口吻和有效技法；不能为了降低词句命中而改动人物关系、增删情节或统一所有声线。',
  review:
    '当前是质量复核。检查提供的正文及本轮生效规则；指出问题须给准确原文、具体阅读影响、例外判断和最小修改方向。未检查、证据不足和有效创作选择分别说明；不要凭词频判定AI概率，也不要将风格偏好变成自动阻断。保留要求的报告模板和字段。',
  record:
    '当前是记忆提取或结构化评估。只让解释性文字清楚简洁；JSON、表格、证据引文、字段名和事实内容按原契约保留。正文专属规则不能删除机器格式、改变评分标准、改写原文证据或补造事实。'
};

function formatRules(rules: Rule[]) {
  const labels = {
    context_required: '判断依据',
    preserve: '保留',
    do_not: '禁止',
    exceptions: '例外'
  } as const;
  const common = Object.fromEntries(
    Object.keys(labels).map((key) => {
      const field = key as keyof typeof labels;
      return [field, rules[0][field].filter((v) => rules.every((r) => r[field].includes(v)))];
    })
  ) as Record<keyof typeof labels, string[]>;
  const base = Object.entries(labels)
    .filter(([key]) => common[key as keyof typeof labels].length)
    .map(([key, label]) => `共同${label}：${common[key as keyof typeof labels].join('；')}`)
    .join('\n');
  return (
    base +
    '\n' +
    rules
      .map((rule) => {
        const details = Object.entries(labels).flatMap(([key, label]) => {
          const field = key as keyof typeof labels;
          const extra = rule[field].filter((v) => !common[field].includes(v));
          return extra.length ? [`${label}：${extra.join('；')}`] : [];
        });
        return [
          `[${rule.id}] ${rule.title}`,
          `触发：${rule.trigger}`,
          `处理：${rule.repair}`,
          ...details
        ].join('\n');
      })
      .join('\n\n')
  );
}

export function expressionPack(
  root: string,
  config: ProjectConfig,
  mode: ExpressionMode
): {
  prompt: string;
  binding?: ExpressionBinding;
  fingerprint: string;
} {
  if (config.expressionRules?.enabled === false) return { prompt: '', fingerprint: 'expression-disabled' };
  validateExpressionSelection(root, config);
  const library = expressionLibrary(root);
  const languageOnly = mode === 'discussion' || mode === 'record' || mode === 'planning' || mode === 'title' || mode === 'title_market';
  const modules = new Set(
    languageOnly
      ? ['LEX', 'SYN', 'IMG', 'VOICE']
      : library.catalog.modules.filter((m) => m.layer === 'core').map((m) => m.id)
  );
  if (mode === 'revision' || mode === 'review') modules.add('EDIT');
  if (mode !== 'record') for (const id of config.expressionRules?.modules ?? []) modules.add(id);
  const rules = library.rules.filter((r) => modules.has(r.module_id));
  const baseModules = new Set(['LEX', 'SYN', 'IMG', 'VOICE']);
  const base = rules.filter(r => baseModules.has(r.module_id));
  const additional = rules.filter(r => !baseModules.has(r.module_id) && r.module_id !== 'EDIT');
  const editing = rules.filter(r => r.module_id === 'EDIT');
  const shared = sharedRuleBlock('expression-base', `${commonPolicy}\n本轮生效基础规则（保留全部触发、处理、例外及共同约束）：\n${formatRules(base)}`);
  const extra = additional.length ? sharedRuleBlock('expression-additional',
    `本轮生效补充规则（与基础规则一起按当前模式适用，保留全部触发、处理、例外及共同约束）：\n${formatRules(additional)}`) : '';
  const edit = editing.length ? sharedRuleBlock('expression-edit',
    `本轮生效编辑规则（与基础及补充规则一起按当前模式适用，保留全部触发、处理、例外及共同约束）：\n${formatRules(editing)}`) : '';
  const prompt = `\n\n<expression_rules version="${library.version}" mode="${mode}">\n${adapters[mode]}\n本轮生效规则由基础部分及存在时的补充、编辑部分组成，均按本模式和原适用条件执行。\n${shared}${extra}${edit}\n</expression_rules>`;
  return {
    prompt,
    fingerprint: expressionFingerprint(root, config),
    binding: {
      version: library.version,
      policyVersion,
      libraryHash: library.hash,
      promptHash: hash(prompt),
      mode,
      modules: [...modules].sort(),
      ruleIds: rules.map((r) => r.id)
    }
  };
}

export function bindExpressionRules(run: Run, binding?: ExpressionBinding) {
  if (binding) (run.expressionRules ??= {})[binding.mode] = binding;
}
