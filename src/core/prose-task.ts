import type { Run } from '../shared/types';
import { prosePath } from './domain';

export type ProseIntent = 'draft' | 'rewrite' | 'revision' | 'continue';

export function authorProseIntent(instruction: string): ProseIntent {
  instruction = instruction.split(/作者本轮修改意见[^：]*：|作者要求：|作者要求生成新的章节候选：/).at(-1)!;
  const clauses = instruction.split(/[。；;\n]/).filter(clause => !/(?:不要|不能|无需|别|不必).{0,6}(?:重写|重做|重新生成)/.test(clause));
  return clauses.some(clause => /整章重写|全文重写|推倒重写|从头重写|彻底重写|大幅重写|重新(?:生成|写)(?:一遍|全文|整章|正文)|重写(?:这一章|本章|整章|正文|全文)/.test(clause)) ? 'rewrite' : 'revision';
}

/** Mode is explicit for new revisions; legacy checkpoints keep their existing candidate. */
export function proseTask(run: Run) {
  const previous = run.changes.find(change => change.path === prosePath(run.chapter))?.content;
  const repair = (run.repairAttempts?.prose ?? 0) > 0;
  const mode = repair || run.proseReviewFeedback ? 'repair'
    : run.proseIntent ?? (previous ? authorProseIntent(run.request) === 'rewrite' ? 'rewrite' : 'continue' : 'draft');
  const guidance = {
    draft: '首次生成：按本章场景与已确认要求写完整正文。',
    rewrite: '整章重写：按作者本轮要求重新组织表达与场面呈现；已确认事件、结果、硬约束和明确保护内容保持。原候选留在历史中，本轮不把其措辞作为必须保留内容。',
    revision: '局部修改：只改作者指定问题，保留未受影响正文、有效线索、确认结果及结尾。返回完整本章正文供宿主比较。',
    continue: '中断续接：prior 是已保存候选，保留有效部分，补齐尚未完成的内容；返回一份完整正文，不重复已写段落。',
    repair: '修复：只处理 repair、reviewFeedback 指定的实际问题，保留有效正文、未受影响内容和结尾，不截断正文凑字数。'
  }[mode];
  return { proseOperation: { mode, instruction: guidance },
    ...(mode !== 'rewrite' && previous ? { prior: previous } : {}),
    ...(mode === 'rewrite' && previous && /保留.{0,24}(?:原稿|旧稿|原文|原句|原话|段落|对白|对话|措辞|句子|原有剧情)|按.{0,12}(?:原稿|旧稿)/.test(run.request)
      ? { protectedTextReference: { content: previous, instruction: '旧候选只用于定位作者明确保护的原文或剧情；其余表达可重写，候选内容不自动成为正式事实。' } } : {}),
    ...(repair ? { repair: run.issues } : {}),
    ...(run.proseReviewFeedback ? { reviewFeedback: run.proseReviewFeedback } : {}) };
}
