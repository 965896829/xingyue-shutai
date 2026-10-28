import type { Change, Run } from '../../shared/types';
import { hash } from '../domain';
import { renderOutline } from './source-reuse';

export interface DocumentDraft extends Change { hash: string; chunks: number }
export interface DraftChange extends Change { append?: boolean; draftHash?: string | null; final?: boolean; /** Host-computed size before expanding verified source fields. */ generatedCharacters?: number }
export const maxDraftChunk = 8000;
export function supportsDocumentDrafts(run: Pick<Run, 'mode' | 'stage' | 'pipeline'>) {
  return run.mode === 'stage' && !run.pipeline && ['S05', 'S06', 'S07', 'S08'].includes(run.stage);
}
export const documentDraftInstructions = `\n长篇规划采用分段保存：预计超过 ${maxDraftChunk} 字符的文件分多轮提交；较短文件一次完整提交，只给 path、baseHash、content，不需要 append、draftHash、final，不为分段而拆分。不设每轮固定章数，按完整内容长度选择自然组：S06通常约15章，S08完整输出通常约8—10章，使用outline引用时按新生成的场面和覆盖字段长度分组，不按展开后的文件长度拆段；复杂内容减少本段章数而不删细节。每轮只调用一次 propose_changes，分段content不超过 ${maxDraftChunk} 字符，留有余量且不得截断一章。仅分段提交使用 append:true、draftHash:null 开始；后续使用上次工具返回的 draftHash，content 只包含新增部分并自行保留换行。分段的中间段 final:false，最后一段 final:true；整份提交不需要完成标记。客户端会先保存每一段，完成后合成同一份阶段候选，仍需作者采纳。读取 candidate:true 可取回未完成草稿；恢复时从已有草稿末尾继续，禁止重复生成已保存部分。宿主在完整提交后自动校验并进入审阅，不再调用validate或发送结束说明；每轮无需重复说明计划。`;

/** Pure preparation: the caller validates paths, permissions and versions before persisting. */
export function prepareDocumentDrafts(run: Run, changes: DraftChange[]) {
  const drafts = structuredClone(run.documentDrafts ?? []);
  const completed: Change[] = [], touched: Change[] = [];
  const keys = new Set<string>();
  for (const change of changes) {
    const key = change.path.replaceAll('\\', '/').toLowerCase();
    if (keys.has(key)) throw new Error('同一次提交不能重复修改同一份文件');
    keys.add(key);
    const at = drafts.findIndex(d => d.path.replaceAll('\\', '/').toLowerCase() === key), prior = drafts[at];
    if (prior && prior.path !== change.path) throw new Error('请使用草稿返回的原始文件路径');
    if (change.append) {
      if (!supportsDocumentDrafts(run)) throw new Error('分段候选用于当前大纲、节奏和细纲阶段');
      if (!Object.hasOwn(change, 'draftHash') || change.draftHash !== (prior?.hash ?? null))
        throw new Error('草稿版本已改变，请读取 candidate:true 后从已保存位置继续');
      if (typeof change.final !== 'boolean') throw new Error('分段提交需明确 final，完成全部内容前使用 false');
      if (!change.content.length && !change.final || (change.generatedCharacters ?? change.content.length) > maxDraftChunk)
        throw new Error(`每段内容须为 1—${maxDraftChunk} 字符，完成标记可使用空内容`);
      if (prior && prior.baseHash !== change.baseHash) throw new Error('分段草稿的正式版本依据不能改变');
      const content = (prior?.content ?? '') + change.content;
      if (content.length > 10_000_000) throw new Error('候选文件超过大小上限');
      const next: DocumentDraft = { path: change.path, baseHash: change.baseHash, content, hash: hash(content), chunks: (prior?.chunks ?? 0) + Number(!!change.content) };
      touched.push(next);
      if (change.final) {
        completed.push({ path: next.path, baseHash: next.baseHash, content: next.content });
        if (at >= 0) drafts.splice(at, 1);
      } else if (at >= 0) drafts[at] = next;
      else drafts.push(next);
    } else {
      // A redundant completion marker on a whole replacement changes no content.
      // Never promote an explicitly unfinished replacement to a complete candidate.
      if (change.final === false) throw new Error('整份提交不能标记 final:false；未完成内容请使用 append:true 分段保存');
      if (prior && change.draftHash !== prior.hash) throw new Error('已有分段草稿；请继续追加，或读取草稿版本后明确替换');
      if (at >= 0) drafts.splice(at, 1);
      const full = { path: change.path, content: change.content, baseHash: change.baseHash };
      touched.push(full); completed.push(full);
    }
  }
  return { drafts, completed, touched };
}
/** Only a verified complete append chain in actual outgoing history can replace a tail. */
export function draftInHistory(run: Run, draft: DocumentDraft, readSource?: (hash: string) => string) {
  let content: string | undefined;
  for (const message of run.messages) {
    if (message.role !== 'assistant') continue;
    for (const call of message.calls ?? []) {
      if (call.name !== 'propose_changes') continue;
      try {
        const parsed = JSON.parse(call.arguments);
        for (const item of parsed.changes ?? []) {
          if (item.path !== draft.path || item.baseHash !== draft.baseHash) continue;
          let addition = item.content;
          if (item.outline) {
            const source = readSource?.(item.outline.sourceHash) ?? run.manifest?.sources.find(s => s.hash === item.outline.sourceHash && hash(s.content) === s.hash)?.content;
            if (source === undefined) { content = undefined; continue; }
            addition = (addition ?? '') + renderOutline(source, item.outline, run.batch);
          }
          if (typeof addition !== 'string') continue;
          if (item.append) {
            if (item.draftHash === null) content = addition;
            else if (content !== undefined && item.draftHash === hash(content)) content += addition;
            else content = undefined;
          } else content = addition;
        }
      } catch { content = undefined; }
    }
  }
  return content !== undefined && hash(content) === draft.hash;
}
export function draftSummary(run: Run, compact = false, readSource?: (hash: string) => string) {
  return run.documentDrafts?.map(d => {
    const known = compact && draftInHistory(run, d, readSource);
    return { path: d.path, baseHash: d.baseHash, draftHash: d.hash, chunks: d.chunks, characters: d.content.length,
      tail: known ? undefined : d.content.slice(-1600), contentInHistory: known ? true : undefined,
      instruction: known ? '已保存内容及其同版本来源可由本轮历史完整还原；使用此draftHash继续追加，无需重读或重写已保存部分。' : '通过 read_document(candidate:true) 读取完整草稿；从末尾继续追加，不重复已保存部分。' };
  });
}

/** Prepare a conservative full candidate; the runner must still validate its complete structure and source versions. */
export function draftCompletionChanges(run: Run): Change[] | null {
  if (!supportsDocumentDrafts(run) || !run.documentDrafts?.length) return null;
  const changes = structuredClone(run.changes), seen = new Set<string>();
  for (const draft of run.documentDrafts) {
    const key = draft.path.replaceAll('\\', '/').toLowerCase();
    // A final field name plus newline can still contain only half a sentence.
    // Implicit budget recovery requires a sentence terminator or a complete table row.
    const lastLine = draft.content.trimEnd().split(/\r?\n/).at(-1)?.trim() ?? '';
    const completeEnding = /[。！？.!?][”’"'」』）)\]】_*`]*$/.test(lastLine) || /^\|(?:[^|\r\n]+\|)+$/.test(lastLine);
    if (seen.has(key) || !draft.content.trim() || !completeEnding || hash(draft.content) !== draft.hash) return null;
    let fence: string | undefined;
    for (const line of draft.content.split(/\r?\n/)) {
      const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
      if (!marker) continue;
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
    }
    if (fence) return null;
    seen.add(key);
    const at = changes.findIndex(change => change.path.replaceAll('\\', '/').toLowerCase() === key);
    if (at >= 0 && changes[at].path !== draft.path) return null;
    const candidate: Change = { path: draft.path, content: draft.content, baseHash: draft.baseHash };
    if (at >= 0) changes[at] = candidate;
    else changes.push(candidate);
  }
  return changes;
}
