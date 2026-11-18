type WritingAction = 'chapter' | 'scene' | 'passage' | 'rewrite' | 'next' | 'resume' | 'discuss' | 'expand' | 'blueprint' | 'character';
const destinations = { chapter: '完整正文', next: '完整正文', rewrite: '完整正文', scene: '正文片段', passage: '局部替换',
  resume: '原操作的未完成片段', discuss: '讨论', expand: '方案补充', blueprint: '作品方案', character: '人物设定候选' } as const;

/** Host-owned scope shared by isolated lab versions, formal snapshots and the editable desk. */
export function writingOperation(input: { project: string; chapter?: number; batch?: { start: number; end: number };
  scene?: number; selection?: { start: number; end: number }; action: WritingAction; version: string | null; previousVersion?: string | null }) {
  return { ...input, batch: input.batch && [input.batch.start, input.batch.end], destination: destinations[input.action] };
}
