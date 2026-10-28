import type { Run } from '../shared/types';
import type { FileStore } from './storage';
import { SkillRegistry, stageSkills } from './skill-registry';
import { stageOutputs, qualityPath } from './domain';

export const automaticRepairLimit = 2;

export function controllerRules(root: string) {
  return new SkillRegistry(root).controller();
}

export function assertControllerRules(root: string, expected: string) {
  if (controllerRules(root).hash !== expected)
    throw new Error('总控规则已更新，请继续当前任务，客户端会重新加载规则并保留已有内容');
}

export function taskEnvelope(
  store: FileStore,
  root: string,
  owner: Pick<Run, 'id'> & Partial<Pick<Run, 'stage' | 'chapter' | 'mode' | 'manifest' | 'baseRevision' | 'skillId' | 'skillHash' | 'parentRunId' | 'continuity' | 'pipeline'>>,
  mode: string = owner.mode ?? 'discussion'
) {
  const p = store.db.project();
  return {
    project_id: p.id,
    ...(p.titlePending ? {
      book_title: null,
      title_guidance: '书名尚未确定。先完成故事方向和设定，不追问书名，不把项目显示名当作书名；作者确认方向后由客户端确认书名。'
    } : {}),
    branch_id: 'main',
    run_id: owner.id,
    budget_root_id: owner.parentRunId ?? owner.id,
    stage: owner.stage ?? p.stage,
    chapter_no: owner.chapter ?? p.chapter,
    expected_revision: owner.baseRevision ?? p.revision,
    ...(owner.mode === 'stage' ? {
      output_versions: [...new Set([...stageOutputs(owner.stage ?? p.stage, p),
        ...(owner.pipeline ? [...stageOutputs('S11', p), qualityPath(owner.chapter ?? p.chapter)] : [])])]
        .map(path => ({ path, baseHash: store.db.document(path)?.hash ?? null })),
      reading_policy: 'output_versions给出本轮目标的正式baseHash；sources中mode:full已包含该版本全文，无需为确认或获取同一哈希再读一次。mode:excerpt只含片段；修改现有文件须先取得未提供的完整正文，保留未变化内容。提交时仍由宿主核对磁盘版本和实际权限。'
    } : {}),
    ...(owner.continuity ? { story_change_scope: { ...owner.continuity, instruction: owner.continuity.mode === 'forward'
      ? '只调整生效章节及其后的未写计划和作者约束，保留已有正文及此前章节设计。先同步大纲，再同步细纲。未发生内容只能记为计划，不能登记为事实。'
      : owner.continuity.mode === 'extraction' ? '依据已有原文纠正记忆，不修改正文或大纲以迎合错误记录。'
        : '按作者要求追溯修改已有故事，列明受影响的后续内容；不要改动无关内容。' } } : {}),
    authorization: {
      mode,
      generate: !['discussion', 'assessment'].includes(mode),
      accepted_stages: p.completed,
      accepted_design_policy: 'accepted_stages 是宿主实际采纳记录，须结合 context_manifest 的当前正式来源版本使用。已采纳版本中明确选定的创作方案可作为后续设计和正文依据；草稿阶段通用的“候选/待确认”措辞不另产生一次批准要求。作者本轮明确修订优先；没有该修订时，authorPremise 中的原始要求优先于生成的规划和摘要，阶段采纳不能把与原始要求冲突的模型建议变成作者硬约束。作者明确保留的决定、仍未选择的互斥方案、实际缺失条件或硬约束冲突仍须处理。计划被采纳不表示事件已经发生，本轮新候选也未因此被采纳。',
      can_approve: false,
      can_commit: false,
      can_publish: false,
      max_repairs: automaticRepairLimit,
      max_rounds: p.config.maxRounds,
      max_tools: p.config.maxTools,
      cost_limit: p.config.stageBudget
    },
    context_manifest: owner.manifest ? {
      id: owner.manifest.id,
      snapshot_id: owner.manifest.snapshotId,
      sources: owner.manifest.sources.map(({ path, hash, required, mode }) => ({ path, hash, required, mode })),
      fact_ids: owner.manifest.factIds
    } : { snapshot_id: store.db.get<string>('headSnapshot'), sources: [], fact_ids: [] },
    skill_lock: { agent_hash: controllerRules(root).hash, skill_id: owner.skillId ?? stageSkills[owner.stage ?? p.stage], task_hash: owner.skillHash ?? null }
  };
}
