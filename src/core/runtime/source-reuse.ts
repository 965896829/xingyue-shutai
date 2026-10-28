import { z } from 'zod';
import type { Run, ProjectState } from '../../shared/types';
import { factSchema } from '../../shared/types';
import { paths, hash, batchPath, activeBatch, prosePath, qualityPath, stageOutputs } from '../domain';
import { FileStore, safePath, fileHash } from '../storage';
import type { DraftChange } from './document-drafts';

export const outlineFields = ['承接', '章节类型', '情节强度', '前300字叙事入口', '核心场面', '主角动作', '外部推动', '状态变化', '设定揭示预算', '主要阅读回报', '人物记忆变化', '章末牵引'] as const;
const roadmapColumns = ['承接上章', '类型', '强度', '前300字入口', '核心场面', '主角动作', '外部推动', '状态变化', '设定揭示', '阅读回报', '人物记忆变化', '章末牵引'];
const text = z.string().min(1).max(10_000_000);
export const changeSubmissionSchema = z.object({
  path: text, baseHash: z.string().nullable(), content: z.string().max(10_000_000).optional(),
  append: z.boolean().optional().describe('仅分段追加时设为true；整份文件提交省略。'),
  draftHash: z.string().nullable().optional().describe('分段首段为null，续段使用上一段回执的draftHash；整份替换已有草稿时也须提供精确版本。'),
  final: z.boolean().optional().describe('append:true时必填：中间段false，最后一段true。整份提交省略，冗余true兼容；false不能作为完整候选。'),
  patch: z.object({ sourceHash: z.string(), edits: z.array(z.object({ before: text, after: z.string() }).strict()).max(100).optional(),
    lines: z.array(z.object({ anchor: text.describe('不含换行；优先匹配唯一完整行，无完整行时须为全文唯一的单行标识。'), text: z.string().describe('替换该来源行的完整文本；可含多行，用于更新一行并紧接新增表格行。') }).strict()).max(100).optional(), append: z.string().optional() }).strict().optional().describe('只修改当前阶段已授权的正式文件或本轮已保存候选；精确绑定来源hash。审稿仅能局部修复当前章质量评分。宿主还原完整候选后仍检查路径、版本和全部模板字段。尚无正式或候选底稿的新文件用content。'),
  outline: z.object({ sourceHash: z.string(), chapters: z.array(z.object({
    chapter: z.number().int().positive(), title: text, scenes: text,
    fields: z.partialRecord(z.enum(outlineFields), text).optional()
  }).strict()).min(1).max(30) }).strict().optional().describe('仅S08当前批次细纲可用；其他阶段省略。')
}).strict();

const anchorLabel = (anchor: string) => JSON.stringify(anchor.length > 160 ? anchor.slice(0, 160) + '…' : anchor);

/** Exact full lines take precedence over unique substrings; no whitespace normalization. */
function lineAnchorOffset(source: string, anchor: string, index: number) {
  const label = `lines[${index}] anchor=${anchorLabel(anchor)}`;
  if (!anchor || /[\r\n]/.test(anchor)) throw new Error(`行更新锚点不能为空或包含换行（${label}）`);
  let occurrences = 0, exactLines = 0, first = -1, exact = -1;
  for (let at = source.indexOf(anchor); at >= 0; at = source.indexOf(anchor, at + 1)) {
    if (!occurrences++) first = at;
    const end = at + anchor.length;
    if ((at === 0 || source[at - 1] === '\n') &&
        (end === source.length || source[end] === '\n' || source.slice(end, end + 2) === '\r\n')) {
      exact = at; exactLines++;
    }
  }
  if (exactLines === 1) return exact;
  if (!exactLines && occurrences === 1) return first;
  throw new Error(`行更新锚点必须在同版本来源中准确且唯一（${label}；完整行匹配=${exactLines}，子串匹配=${occurrences}）`);
}

/** All edits bind to one immutable source version, with overlapping ranges rejected. */
export function patchDocument(source: string, patch: NonNullable<z.infer<typeof changeSubmissionSchema>['patch']>) {
  if (hash(source) !== patch.sourceHash) throw new Error('增量更新的来源版本已改变');
  const ranges = (patch.edits ?? []).flatMap((edit, index) => {
    const start = source.indexOf(edit.before);
    // Only an already-satisfied table blank-line removal is a provable no-op.
    // Never infer success for missing semantic edits, ambiguous rows or stale hashes.
    if (start < 0 && /^(?:\r?\n){2,}\|[^\r\n]+\|$/.test(edit.before) &&
        edit.after === edit.before.replace(/^(?:\r?\n)+/, edit.before.startsWith('\r\n') ? '\r\n' : '\n')) {
      const at = source.indexOf(edit.after);
      if (at >= 0 && source.indexOf(edit.after, at + 1) < 0) return [];
    }
    if (start < 0 || source.indexOf(edit.before, start + 1) >= 0) throw new Error(`增量更新锚点必须在来源中准确且唯一，请扩展到所属标题或整行（edits[${index}] before=${anchorLabel(edit.before)}）`);
    return [{ start, end: start + edit.before.length, after: edit.after }];
  });
  for (const [index, line] of (patch.lines ?? []).entries()) {
    const at = lineAnchorOffset(source, line.anchor, index);
    const start = source.lastIndexOf('\n', at) + 1;
    let end = source.indexOf('\n', at);
    if (end < 0) end = source.length;
    if (source[end - 1] === '\r') end--;
    // A table row replacement may include its own final line terminator.
    // The source range excludes that terminator: keeping both would split the
    // table. Remove exactly one only for contiguous row-only replacements;
    // explicit blank lines, prose, code and end-of-file insertions stay literal.
    const row = (value: string) => /^\|[^\r\n]+\|[ \t]*$/.test(value);
    const withoutTerminator = line.text.replace(/\r?\n$/, '');
    const next = source.slice(end).match(/^\r?\n([^\r\n]*)/)?.[1];
    const after = withoutTerminator !== line.text && row(source.slice(start, end)) &&
      next !== undefined && row(next) && withoutTerminator.split(/\r?\n/).every(row)
      ? withoutTerminator : line.text;
    ranges.push({ start, end, after });
  }
  ranges.sort((a, b) => a.start - b.start);
  if (ranges.some((r, i) => i > 0 && r.start < ranges[i - 1].end)) throw new Error('增量更新的替换范围不能重叠');
  let content = source;
  for (const r of ranges.reverse()) content = content.slice(0, r.start) + r.after + content.slice(r.end);
  content += patch.append ?? '';
  if (content.length > 10_000_000) throw new Error('候选文件超过大小上限');
  return content;
}

export function roadmapRows(source: string) {
  const rows = new Map<number, Record<string, string>>();
  let header: string[] | undefined;
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) { header = undefined; continue; }
    const cells = line.trim().split(/(?<!\\)\|/).slice(1, -1).map(c => c.trim());
    if (cells[0] === '章节' && roadmapColumns.every(c => cells.includes(c))) { header = cells; continue; }
    if (!header || cells.every(c => /^:?-+:?$/.test(c))) continue;
    const match = cells[0]?.match(/^(?:第\s*)?(\d+)\s*(?:章|[：:、.\s]|$)/);
    if (!match || cells.length !== header.length) throw new Error('章节总纲表格不能可靠引用，请使用完整 content 提交细纲');
    const chapter = Number(match[1]);
    if (rows.has(chapter)) throw new Error('章节总纲存在重复章号，不能自动复用');
    rows.set(chapter, Object.fromEntries(header.map((key, i) => [key, cells[i].replace(/<br\s*\/?\s*>/gi, '\n')])));
  }
  return rows;
}

export function renderOutline(source: string, outline: NonNullable<z.infer<typeof changeSubmissionSchema>['outline']>, batch: { start: number; end: number }) {
  if (hash(source) !== outline.sourceHash) throw new Error('章节总纲来源版本已改变');
  const rows = roadmapRows(source), seen = new Set<number>();
  return outline.chapters.map(chapter => {
    if (chapter.chapter < batch.start || chapter.chapter > batch.end || seen.has(chapter.chapter)) throw new Error('细纲引用的章号重复或超出当前批次');
    if (/[\r\n]/.test(chapter.title)) throw new Error('章节标题不能包含换行');
    seen.add(chapter.chapter);
    const row = rows.get(chapter.chapter);
    if (!row) throw new Error(`章节总纲缺少第${chapter.chapter}章，不能猜补原字段`);
    const fields = outlineFields.map((field, i) => {
      const value = chapter.fields?.[field] ?? row[roadmapColumns[i]];
      if (!value?.trim() || /^(?:待补|待定|TODO|—|-)$/.test(value.trim())) throw new Error(`第${chapter.chapter}章的${field}必须补足后再引用`);
      return `- ${field}：${field === '情节强度' && /^[1-5]$/.test(value.trim()) ? value.trim() + '/5' : value}`;
    });
    return `\n\n## 第${String(chapter.chapter).padStart(3, '0')}章：${chapter.title}\n\n${fields.join('\n')}\n\n### 场面推进\n\n${chapter.scenes}\n`;
  }).join('');
}

/** Materialize before the existing path, repair, version, structure and commit guards. */
export function materializeChanges(store: FileStore, run: Run, project: ProjectState, raw: unknown[]): DraftChange[] {
  const grouped: z.infer<typeof changeSubmissionSchema>[] = [];
  for (const value of raw) {
    const change = changeSubmissionSchema.parse(value);
    safePath(store.root, change.path);
    if (change.patch && (change.content !== undefined || change.outline || change.append || change.final === false || change.draftHash !== undefined))
      throw new Error('patch 不能与完整内容、总纲引用或分段参数混用');
    const prior = grouped.find(item => item.path === change.path);
    if (prior?.patch && change.patch) {
      if (prior.baseHash !== change.baseHash || prior.patch.sourceHash !== change.patch.sourceHash)
        throw new Error('同文件增量更新必须绑定同一个来源版本');
      if (prior.patch.append && change.patch.append) throw new Error('同文件的多个末尾追加请合并为一个 patch');
      // Evaluate all ranges together against the immutable original. Overlapping
      // anchors still fail atomically in patchDocument; no sequential rebasing.
      prior.patch = changeSubmissionSchema.shape.patch.parse({ sourceHash: prior.patch.sourceHash,
        edits: [...(prior.patch.edits ?? []), ...(change.patch.edits ?? [])],
        lines: [...(prior.patch.lines ?? []), ...(change.patch.lines ?? [])],
        append: prior.patch.append || change.patch.append });
    } else grouped.push(change);
  }
  return grouped.map(change => {
    if (change.patch) {
      const planningFile = run.mode === 'stage' && !run.pipeline && /^S0[1-9]$/.test(run.stage) && stageOutputs(run.stage, project).includes(change.path);
      const reviewFile = run.mode === 'stage' && run.stage === 'S10' && run.pipeline?.phase === 'review' && change.path === qualityPath(run.chapter);
      if (!planningFile && !reviewFile && run.mode !== 'revision' && run.stage !== 'S11' && run.pipeline?.phase !== 'memory') throw new Error('增量更新仅用于当前阶段已授权文件、章后台账或授权修订');
      const candidate = run.changes.find(c => c.path === change.path);
      const source = candidate ? candidate.content : store.readAccepted(change.path).content;
      try {
        return { path: change.path, baseHash: change.baseHash, content: patchDocument(source, change.patch) };
      } catch (error) {
        throw new Error(`增量更新失败 [${change.path}]：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (change.outline) {
      if (run.mode !== 'stage' || run.pipeline || run.stage !== 'S08' || change.path !== batchPath(activeBatch(project)))
        throw new Error('总纲字段引用仅用于当前 S08 批次细纲');
      const doc = store.readAccepted(paths.outline);
      if (fileHash(safePath(store.root, paths.outline)) !== doc.hash || store.inspect(paths.outline)?.status !== 'accepted')
        throw new Error('章节总纲存在未确认改动');
      const prior = run.documentDrafts?.find(d => d.path === change.path);
      if (change.append && prior && change.outline.chapters.some(c => new RegExp(`^## 第0*${c.chapter}章[：:]`, 'm').test(prior.content)))
        throw new Error('该章节已经保存在草稿中，不得再次追加');
      const content = (change.content ?? '') + renderOutline(doc.content, change.outline, activeBatch(project));
      return { path: change.path, baseHash: change.baseHash, content, append: change.append, draftHash: change.draftHash, final: change.final,
        generatedCharacters: JSON.stringify(change).length };
    }
    if (change.content === undefined) throw new Error('文件候选需要 content、patch 或 outline');
    return { ...change, content: change.content };
  });
}

export const factSubmissionSchema = z.object({ ...factSchema.shape, evidence: z.array(z.union([
  factSchema.shape.evidence.element,
  z.object({ source: z.literal('prose'), quote: text }).strict()
])).min(1) });
export function materializeFacts(store: FileStore, run: Run, raw: unknown[]) {
  return raw.map(value => {
    const fact = factSubmissionSchema.parse(value);
    return factSchema.parse({ ...fact, evidence: fact.evidence.map(e => {
      if (!('source' in e)) return e;
      const path = prosePath(run.chapter), candidate = run.changes.find(c => c.path === path);
      const source = candidate ?? store.readAccepted(path);
      const digest = hash(source.content), expected = run.pipeline?.proseHash ?? run.sourceProseHash ?? run.manifest?.sources.find(s => s.path === path)?.hash;
      if (!expected || digest !== expected) throw new Error('正文证据简称缺少已绑定的同版本正文');
      return { path, hash: digest, quote: e.quote };
    }) });
  });
}

export const sourceReuseInstructions = `\nS08可通过 propose_changes 的 outline 引用已采纳章节总纲：sourceHash 使用总纲版本，chapters 逐章提交 chapter、title、scenes；十二字段（包括核心场面概述）由宿主复用总纲。scenes 只写重新展开的完整可执行场面（通常三场的编号列表），宿主将其置于十二字段之后的“### 场面推进”小节，与 Codex 原产物布局一致；不能用总纲摘要代替场面推进；需要深化或与节奏同步的字段放入 fields，以模板原字段名为键。content 只写一次批次头部。允许与 append/draftHash/final 组合，宿主按实际新生成参数大小分段，引用展开后仍为原模板十二字段完整 Markdown，不省略章节。总纲缺少字段或不能准确解析时使用完整 content，不猜补。\n当前阶段已授权的既有文档可用 patch 做局部修改，章后台账优先使用它：sourceHash 是当前候选或正式文件的内容 hash，edits 为 before/after 精确替换（before 必须唯一，可带所属标题）；表格已有行可用 lines:[{anchor:"来源中唯一的行标识",text:"替换该行的完整文本，可含新增的多行"}]，不重抄整行旧值；anchor 不含换行，优先匹配唯一完整行；没有完整行时须为全文唯一子串，不忽略空格。追加表格行时用最后一条唯一行标识，将该行及新增行放在 text，行间不插空行。已保存回执即确认本次提交的版本；没有本地报错或实际内容问题时不猜测换行问题，不为排版反复补丁或重读。只在末尾新增时用 append。未变化部分由宿主逐字保留，不重抄。新文件、空模板大幅填充或整份多数内容确需改变时用 content；局部变化用 patch，不为增量重复抄写大量旧文。不能把差异说明当成最终文件。所有方式还原完整候选后按相同模板校验。结构化事实引用指定正文时可用 evidence:[{source:"prose",quote:"准确原文"}]，宿主绑定指定正文的 path/hash，不必逐条抄写；其他来源仍需完整证据。`;
