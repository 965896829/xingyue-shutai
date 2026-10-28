import fs from 'node:fs';
import path from 'node:path';
import { hash } from './domain';

export interface NamingModule {
  id: string;
  title: string;
  content: string;
}
export interface NamingRules {
  version: string;
  hash: string;
  core: string;
  modules: NamingModule[];
}

// Keep the author's complete document on disk. Only genre/tag bodies and test
// scenarios are omitted from the initial prompt; shared constraints stay intact.
export function parseNamingRules(text: string): NamingRules {
  const version = text.match(/^版本：([^\r\n]+)/m)?.[1].trim();
  if (version !== 'v2.0')
    throw new Error('命名规则版本无法识别，请检查 naming-system.md；不会跳过规则继续生成');
  const sections = [...text.matchAll(/^## ([一二三四五六七八九十]+)、[^\r\n]+/gm)];
  if (sections.map((s) => s[1]).join(',') !== '一,二,三,四,五,六,七,八,九,十,十一,十二')
    throw new Error('命名规则章节缺失或顺序异常，请恢复完整 v2.0 文件');
  const modules: NamingModule[] = [];
  const core = [text.slice(0, sections[0].index).trim()];
  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const body = text.slice(section.index, sections[i + 1]?.index ?? text.length).trim();
    if (section[1] === '六' || section[1] === '七') {
      const headings = [...body.matchAll(/^### ([GT]\d{2}) ([^\r\n]+)/gm)];
      const prefix = section[1] === '六' ? 'G' : 'T';
      if (!headings.length) throw new Error(`命名规则 ${prefix} 模块为空`);
      core.push(body.slice(0, headings[0].index).trim());
      for (let j = 0; j < headings.length; j++) {
        const m = headings[j];
        const content = body.slice(m.index, headings[j + 1]?.index ?? body.length).trim();
        if (
          !m[1].startsWith(prefix) ||
          modules.some((x) => x.id === m[1]) ||
          !content.slice(m[0].length).trim()
        )
          throw new Error(`命名规则模块无效或重复：${m[1]}`);
        modules.push({ id: m[1], title: m[2].trim(), content });
      }
    } else if (section[1] !== '十一') core.push(body);
  }
  // v2.0 promises these modules. A partial copy must fail rather than silently
  // present a truncated rule set as the complete system.
  for (const [prefix, count] of [
    ['G', 37],
    ['T', 12]
  ] as const)
    for (let n = 1; n <= count; n++) {
      const id = `${prefix}${String(n).padStart(2, '0')}`;
      if (!modules.some((m) => m.id === id)) throw new Error(`命名规则缺少 ${id} 模块`);
    }
  return { version, hash: hash(text), core: core.join('\n\n'), modules };
}

export function loadNamingRules(root: string) {
  return parseNamingRules(fs.readFileSync(path.join(root, 'references/naming-system.md'), 'utf8'));
}

export function selectNamingModules(rules: NamingRules, genre: string) {
  const byLabel = new Map<string, string>();
  for (const m of rules.modules) {
    byLabel.set(m.id, m.id);
    byLabel.set(m.title, m.id);
    if (m.id.startsWith('T')) for (const label of m.title.split(/[、与]/)) byLabel.set(label, m.id);
  }
  // The existing client's default spells this label in the opposite order.
  byLabel.set('脑洞玄幻', 'G08');
  byLabel.set('短篇', 'T12');
  // Exact compound aliases only: these select reference modules, never create
  // world facts. Do not infer genres from substrings or negative statements.
  const compound: Record<string, string[]> = {
    '都市悬疑': ['G01', 'G14'],
    '都市规则悬疑': ['G01', 'G14', 'T01'],
    '规则悬疑': ['G14', 'T01'],
    '大逃杀': ['T01'],
    '生存游戏': ['T01'],
    '智斗': []
  };
  const ids = new Set<string>(),
    unmatched: string[] = [];
  for (const label of genre
    .split(/[+＋/／,，、;；|｜\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)) {
    if (Object.hasOwn(compound, label)) { for (const id of compound[label]) ids.add(id); continue; }
    const id = byLabel.get(label);
    if (id) ids.add(id);
    else unmatched.push(label);
  }
  if (!ids.size || unmatched.length) ids.add('G37');
  return { modules: rules.modules.filter((m) => ids.has(m.id)), unmatched };
}

export function namingPrompt(rules: NamingRules, genre: string) {
  const selected = selectNamingModules(rules, genre);
  return `${rules.core}

## 客户端的命名规则加载说明

- 完整规则版本：${rules.version}；完整文件哈希：${rules.hash}。此哈希覆盖未预载模块及验收情境，恢复任务时同样核对。
- 通用规则已完整加载；分类和标签按需读取，模块编号仅是本规则内部索引。最低验收用例保留在原文件，不作为故事素材传入。
- 项目题材字段只用于预载，不证明具体对象的文化、年代或制度。已预载：${selected.modules.map((m) => m.id + ' ' + m.title).join('；')}。
- 尚未精确映射的题材标签：${JSON.stringify(selected.unmatched)}。未知标签按通用规则和本书已确认事实判断，不默认玄幻，不从否定语句、对比举例或标签推定世界设定。
- 为未预载题材、另一世界或特殊对象命名之前，先使用 read_naming_rules 读取相关模块；可以组合多个模块，不能认为主分类覆盖所有对象。已预载模块无需重复读取。
- 同时读取本书已有的人物、世界规则、规则术语表和知情边界等相关资料。缺少会改变世界或身份的依据时使用 ask_author，不以规则示例补设定。
- 客户端已有候选确认、版本校验、历史快照和结构化事实；尚未提供完整的独立命名实体台账与按实体一键改名。事实 id 不等于实体 id，不能声称软件已自动完成这些能力；只能在本阶段许可的档案中提出有依据的候选，名称语境仍须模型及作者审阅。

### 可按需读取的模块索引

${rules.modules.map((m) => `- ${m.id}：${m.title}`).join('\n')}

### 本次预载模块正文

${selected.modules.map((m) => m.content).join('\n\n')}`;
}

export function readNamingModules(root: string, ids: string[], expectedHash: string) {
  const rules = loadNamingRules(root);
  if (rules.hash !== expectedHash) throw new Error('命名规则在任务执行期间已改变，请重建任务上下文');
  if (!ids.length || ids.length > 8) throw new Error('每次读取 1—8 个命名模块');
  const modules = [...new Set(ids)].map((id) => {
    const m = rules.modules.find((m) => m.id === id);
    if (!m) throw new Error(`不存在的命名模块：${id}；请使用索引中的 G/T 编号`);
    return m;
  });
  return { source: 'references/naming-system.md', version: rules.version, hash: rules.hash, modules };
}
