/** Public execution metadata only; never contains a model's private reasoning. */
export type GenerationPhase = 'preparing' | 'compacting' | 'waiting' | 'thinking' | 'responding' | 'tool_input' | 'tools' | 'searching' | 'checking' | 'retrying';
export interface GenerationActivity {
  startedAt: string;
  updatedAt: string;
  phase: GenerationPhase;
  operation?: GenerationOperation;
  stoppedAt?: string;
}
export interface GenerationOwner {
  status: string;
  activity?: GenerationActivity;
}
export const generationLabels: Record<GenerationPhase, string> = {
  preparing: '正在准备', compacting: '正在整理上下文', waiting: '正在等待回复', thinking: '正在思考', responding: '正在回复',
  tool_input: '正在生成结果', tools: '正在执行工具', searching: '正在联网搜索', checking: '正在检查结果', retrying: '正在恢复连接'
};
const operationLabels = {
  read_book: '正在读取作品资料',
  read_document: '正在读取作品资料',
  read_task_candidate: '正在核对当前候选',
  search_memory: '正在检索作品记忆',
  search_history: '正在回查聊天记录',
  read_rule: '正在查阅创作规则',
  read_naming_rules: '正在查阅命名规则',
  public_search: '正在检索公开资料',
  extract_pages: '正在读取网页内容',
  propose_action: '正在整理执行方案',
  propose_changes: '正在整理文稿候选',
  propose_memory: '正在整理作品记忆',
  validate: '正在核对生成结果',
  ask_author: '正在整理待确认问题'
};
export type GenerationOperation = keyof typeof operationLabels;
export function generationOperation(name: string): GenerationOperation | undefined {
  return Object.hasOwn(operationLabels, name) ? name as GenerationOperation : undefined;
}
export function generationActivityLabel(activity?: GenerationActivity) {
  const operation = activity?.operation && generationOperation(activity.operation);
  if (operation && (activity.phase === 'tools' || activity.phase === 'searching')) return operationLabels[operation];
  return generationLabels[activity?.phase ?? 'preparing'] ?? '正在处理';
}
/** A resumed execution gets its own clock; time spent waiting for the author is excluded. */
export function syncGeneration(owner: GenerationOwner, at = new Date().toISOString()) {
  if (owner.status === 'running') {
    if (!owner.activity || owner.activity.stoppedAt)
      owner.activity = { startedAt: at, updatedAt: at, phase: 'preparing' };
  } else if (owner.activity && !owner.activity.stoppedAt) owner.activity.stoppedAt = at;
}
export function updateGeneration(owner: GenerationOwner, phase: GenerationPhase, at = new Date().toISOString(), operation?: GenerationOperation) {
  if (owner.status !== 'running') return false;
  syncGeneration(owner, at);
  if (owner.activity!.phase === phase && owner.activity!.operation === operation) return false;
  owner.activity = { ...owner.activity!, phase, operation, updatedAt: at };
  return true;
}
export function elapsedGeneration(activity: GenerationActivity, now = Date.now()) {
  const duration = (activity.stoppedAt ? Date.parse(activity.stoppedAt) : now) - Date.parse(activity.startedAt);
  return Number.isFinite(duration) ? Math.max(0, Math.floor(duration / 1000)) : 0;
}
export function formatElapsed(seconds: number) {
  const hours = Math.floor(seconds / 3600), minutes = Math.floor(seconds % 3600 / 60), rest = seconds % 60;
  return hours ? `${hours} 小时 ${minutes} 分 ${rest} 秒` : minutes ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`;
}

/** UTF-16 offsets use the same indexing as persisted JS strings. Overlapping events are idempotent. */
export interface StreamText { offset: number; text: string }
function boundedStream(value: StreamText): StreamText {
  const skip = Math.max(0, value.text.length - 64000);
  return skip ? { offset: value.offset + skip, text: value.text.slice(skip) } : value;
}
export function streamText(previous: StreamText | undefined, incoming: StreamText): StreamText {
  if (!previous) return boundedStream(incoming);
  const end = previous.offset + previous.text.length;
  if (incoming.offset > end) return boundedStream(incoming); // recover the gap from the next persisted snapshot
  if (incoming.offset < previous.offset) return previous;
  return boundedStream({ offset: previous.offset, text: previous.text.slice(0, incoming.offset - previous.offset) + incoming.text + previous.text.slice(Math.max(0, incoming.offset + incoming.text.length - previous.offset)) });
}
export function visibleStreamText(saved: string, live?: StreamText) {
  if (!live || live.offset > saved.length || live.offset + live.text.length <= saved.length) return saved;
  return saved.slice(0, live.offset) + live.text;
}
