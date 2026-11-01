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
  return { sources, excluded, phase };
}

export function modelSource(source: ContextSource) {
  return { path: source.path, hash: source.hash, content: source.content,
    mode: source.mode, ranges: source.ranges, category: source.category, required: source.required };
}
