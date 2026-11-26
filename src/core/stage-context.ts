import type { ContextManifest, ContextSource, ProjectState } from '../shared/types';
import { paths, renderConfig, renderProgress } from './domain';
import { approvedCreation } from '../shared/creation';
import { contractPath, renderContract } from './tags';
import type { PromptPhase } from './prompt-profile';

/** A model projection never mutates the host manifest or its complete invalidation dependencies. */
export function stageSources(manifest: ContextManifest, project: ProjectState, phase: PromptPhase) {
  const creation = approvedCreation(project);
  const excluded: { path: string; hash: string; reason: string }[] = [];
  const sources = manifest.sources.flatMap(source => {
    const same = (content: string) => source.mode === 'full' && source.content === content;
    const reason = phase === 'memory' && source.layer === 'chapter_plan' && /^(05_|06_)/.test(source.path)
      ? '记忆提取依据最终正文；规划保留在宿主依赖与独立计划核验中，不混入已发生事件'
      : source.path === contractPath && creation && same(renderContract(creation.spec, creation.contract))
      ? '结构化创作约定已完整提供，省略相同内容的显示文档'
      : source.path === paths.config && same(renderConfig(project))
        ? '本轮适用创作配置已提供，执行配置由宿主管理'
        : source.path === paths.progress && same(renderProgress(project))
          ? '任务范围已提供；作品游标与阶段推进由宿主管理' : undefined;
    if (reason) { excluded.push({ path: source.path, hash: source.hash, reason }); return []; }
    return [modelSource(source)];
  });
  if (manifest.stage === 'S10' && phase === 'prose') condensePlanDecisions(sources);
  return { sources, excluded, phase };
}

// Keep the original hashes and source ranges for lookup. Only the writer's projected
// plan text gets cross-references. Formal checks still receive the verbatim documents.
function condensePlanDecisions(sources: ReturnType<typeof modelSource>[]) {
  const plans = sources.filter(source => /^(05_|06_)/.test(source.path) && source.category === 'plan');
  if (plans.length < 2) return;
  const decisions = new Map<string, { path: string; number?: number }>();
  let next = 1;
  function passages(content: string, visit: (text: string) => string) {
    const cell = (value: string) => {
      const text = value.trim();
      return text.length >= 16 && /\p{L}/u.test(text) ? value.replace(text, () => visit(text)) : value;
    };
    return content.replace(/[^\r\n]+/g, line => {
      if (/^\s*[#>`]/.test(line)) return line;
      if (/^\s*\|/.test(line)) return line.includes('\\|') ? line : line.split('|').map(cell).join('|');
      const [, label, value] = line.match(/^(\s*(?:[-*+]\s+|\d+[.、]\s*)?(?:[^：:|]{1,32}[：:]\s*)?)(.*)$/su)!;
      return label + cell(value);
    });
  }
  for (const source of plans) passages(source.content, text => {
    const first = decisions.get(text);
    if (!first) decisions.set(text, { path: source.path });
    else if (first.path !== source.path && first.number === undefined) first.number = next++;
    return text;
  });
  if (next === 1) return;
  const marked = new Set<number>();
  for (const source of plans) {
    const content = passages(source.content, text => {
      const decision = decisions.get(text);
      if (!decision?.number) return text;
      if (decision.path !== source.path) return '〔同 P' + decision.number + '〕';
      if (marked.has(decision.number)) return text;
      marked.add(decision.number);
      return text + '〔P' + decision.number + '〕';
    });
    if (content !== source.content) Object.assign(source, { content, mode: 'excerpt' as const });
  }
}

export function modelSource(source: ContextSource) {
  return { path: source.path, hash: source.hash, content: source.content,
    mode: source.mode, ranges: source.ranges, category: source.category, required: source.required };
}
