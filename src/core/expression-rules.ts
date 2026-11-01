import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { hash } from './domain';
import type { ProjectConfig, Run } from '../shared/types';
import type { ExpressionBinding, ExpressionCatalog, ExpressionMode } from '../shared/expression';
import { sharedRuleBlock } from './runtime/prompt-cache';

const policyVersion = 'natural-expression-5';
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

const commonPolicy = `表达指导优先级：作者当前明确要求 → 已确认作品声音 → 当前人物与叙述方式 → 场景需要 → 默认表达建议。
规则仅在触发条件成立且例外不适用时使用，不增加权限、不改事实和机器字段，不是AI身份鉴定。不以禁词、心理比例、微动作数量或比喻密度评判作品；保留有功能的直述、冷叙述、长句、日常、幽默和停顿。
默认仅装入本阶段必要规则，作者显式选择的模块完整加载。引文和证据保持原样，不输出自检或规则报告。`;
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
  const defaults = new Set(mode === 'record' ? [] : ['VOICE-001']);
  if (!languageOnly) for (const id of ['META-001', 'POV-001', 'DIA-001', 'STATE-001']) defaults.add(id);
  if (mode === 'revision' || mode === 'review') defaults.add('EDIT-001');
  const selectedModules = new Set(mode === 'record' ? [] : config.expressionRules?.modules ?? []);
  const rules = library.rules.filter((r) => defaults.has(r.id) || selectedModules.has(r.module_id));
  const modules = new Set(rules.map(r => r.module_id));
  const baseModules = new Set(['LEX', 'SYN', 'IMG', 'VOICE']);
  const base = rules.filter(r => baseModules.has(r.module_id));
  const additional = rules.filter(r => !baseModules.has(r.module_id) && r.module_id !== 'EDIT');
  const editing = rules.filter(r => r.module_id === 'EDIT');
  const shared = sharedRuleBlock('expression-base', commonPolicy);
  const language = base.length ? sharedRuleBlock('expression-language', `本轮表达规则（完整保留触发与例外）：\n${formatRules(base)}`) : '';
  const extra = additional.length ? sharedRuleBlock('expression-additional',
    `本轮生效补充规则（与基础规则一起按当前模式适用，保留全部触发、处理、例外及共同约束）：\n${formatRules(additional)}`) : '';
  const edit = editing.length ? sharedRuleBlock('expression-edit',
    `本轮生效编辑规则（与基础及补充规则一起按当前模式适用，保留全部触发、处理、例外及共同约束）：\n${formatRules(editing)}`) : '';
  const prompt = `\n\n<expression_rules version="${library.version}" mode="${mode}">\n${adapters[mode]}\n${shared}${language}${extra}${edit}\n</expression_rules>`;
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
