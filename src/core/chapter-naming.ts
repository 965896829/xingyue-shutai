import type { Change, Issue, Run, StageId } from '../shared/types';
import type { ChapterNaming } from '../shared/chapter-naming';
import type { FileStore } from './storage';
import { batchPath, detailPath, hash, prosePath, taskPath } from './domain';
import { pendingSource } from './memory-source';

export const chapterNamingStages: StageId[] = ['S08', 'S09', 'S10'];
export const chapterNamingSkills = ['webnovel-batch-outline', 'webnovel-chapter-planner', 'webnovel-chapter-drafter'];
const batchFile = /^06_章节设计\/第\d+[-—]\d+章细纲\.md$/;
const taskFile = /^06_章节设计\/第(\d+)章任务清单\.md$/;
const proseFile = /^07_正文章节\/第(\d+)章\.md$/;
const meaningful = (name: string) => !!name.trim() && !/^(?:标题|章节标题|待填写|待生成|待定|未命名)[。.]?$/.test(name.trim());
const memoryHash = (run: Run) => hash(JSON.stringify({ facts: run.facts, retractions: run.factRetractions ?? [] }));
const requestsChapterRename = (instruction: string) => instruction.split(/[。；;\n]/).some(clause => {
  if (/(?:不要|不改|保留|沿用|保持).{0,10}(?:章名|章节.{0,3}(?:名字|名称|标题))|(?:章名|章节标题).{0,8}(?:不改|不变|保留)/.test(clause)) return false;
  return /章名|章节.{0,3}(?:名字|名称|标题)/.test(clause);
});

/** Recognize title slots only; structural file headings and fenced examples stay literal. */
export function chapterNameSlots(content: string, file: string) {
  const batch = batchFile.test(file), task = file.match(taskFile), prose = file.match(proseFile);
  const slots: { chapter: number; name: string; start: number; end: number }[] = [];
  let fence = '', firstLine = true;
  for (const line of content.matchAll(/[^\r\n]+/g)) {
    const text = line[0], marker = text.trim().match(/^(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ''; firstLine = false; continue; }
    if (fence || !text.trim()) continue;
    const heading = batch ? text.match(/^( {0,3}##\s+第(\d+)章\s*[：:]\s*)(.*?)(\s*)$/)
      : prose && firstLine ? text.match(/^( {0,3}(?:#{1,2}\s+)?第(\d+)章(?:\s*[：:]\s*|[ \t]+))(.*?)(\s*)$/) : null;
    const field = task ? text.match(/^(\s*[-*+]\s+(?:\*\*)?本章标题(?:\*\*)?\s*[：:]\s*)(.*?)(\s*)$/) : null;
    if (heading) {
      const start = line.index! + heading[1].length;
      slots.push({ chapter: Number(heading[2]), name: heading[3], start, end: start + heading[3].length });
    } else if (field) {
      const start = line.index! + field[1].length;
      slots.push({ chapter: Number(task![1]), name: field[2], start, end: start + field[2].length });
    }
    firstLine = false;
  }
  let skeleton = content;
  for (const slot of [...slots].reverse()) skeleton = skeleton.slice(0, slot.start) + `\u0000chapter:${slot.chapter}\u0000` + skeleton.slice(slot.end);
  return { slots, skeleton };
}

export function makeChapterNaming(store: FileStore, run: Run, instruction = '', candidates: Change[] = []): ChapterNaming {
  const binding: ChapterNaming = { version: 1 };
  const read = (file: string) => {
    const document = store.db.document(file);
    if (!document?.hash || pendingSource(store.db.project(), file) || store.inspect(file)?.status !== 'accepted') return;
    return { path: file, hash: document.hash, content: store.readAccepted(file).content };
  };
  const onlyNames = !/(?:不只|不仅|不是只|不要只).{0,12}(?:章名|章节)/.test(instruction) && /(?:只|仅)(?:需要|需)?(?:修改|改|调整|优化|更换|重新生成)?(?:一下)?(?:这些|全部|所有)?(?:章名|章节(?:的)?(?:名字|名称|标题))/.test(instruction);
  // S08 owns the batch names; S09 can explicitly revise the existing task title.
  if (onlyNames && ['S08', 'S09'].includes(run.stage)) {
    const files = run.stage === 'S08' ? [batchPath(run.batch)] : [taskPath(run.chapter), ...candidates.filter(change => change.path === detailPath(run.chapter)).map(change => change.path)];
    const documents = files.flatMap(file => {
      const candidate = candidates.find(change => change.path === file), source = candidate ? { path: file, content: candidate.content, hash: hash(candidate.content) } : read(file);
      return source && (chapterNameSlots(source.content, file).slots.length || file === detailPath(run.chapter)) ? [source] : [];
    });
    if (documents.some(document => chapterNameSlots(document.content, document.path).slots.length)) { binding.renameOnly = { documents, memoryHash: memoryHash(run) }; return binding; }
  }
  if (run.stage === 'S08' || requestsChapterRename(instruction)) return binding;
  // The accepted per-chapter decision takes precedence over its earlier batch plan.
  for (const file of run.stage === 'S10' ? [taskPath(run.chapter), batchPath(run.batch)] : [batchPath(run.batch)]) {
    const source = read(file);
    if (!source) continue;
    const titles = chapterNameSlots(source.content, file).slots.filter(slot => slot.chapter === run.chapter);
    if (titles.length !== 1 || !meaningful(titles[0].name)) continue;
    const title = titles[0].name.replace(new RegExp(`^第0*${run.chapter}章\\s*[：:]\\s*`), '');
    if (!meaningful(title)) continue;
    binding.source = { path: source.path, hash: source.hash, chapter: run.chapter, title };
    break;
  }
  return binding;
}

export function upgradesChapterNaming(run: Run, instruction: string) {
  if (!chapterNamingStages.includes(run.stage) || run.accepted || run.pipeline?.proseHash || !(run.mode === 'stage' || run.design)) return false;
  return requestsChapterRename(instruction);
}

export function chapterNamingContext(run: Run) {
  if (!run.chapterNaming) return {};
  return { chapterNamingReference: {
    ...(run.chapterNaming.source ? { acceptedTitle: run.chapterNaming.source } : {}),
    ...(run.chapterNaming.renameOnly ? { scope: '只修改已列文稿的章节标题，章号、剧情、场面、十二字段及其他文字保持原文；优先使用精确patch，不提交故事记忆。', documents: run.chapterNaming.renameOnly.documents.map(({ path, hash }) => ({ path, hash })) } : {})
  } };
}

/** Synchronize a known title before prose hashing/review; never rewrite the body or chapter number. */
export function alignChapterTitle(run: Run, change: Change): Change {
  const source = run.chapterNaming?.source;
  if (!source || run.chapterNaming?.renameOnly || ![taskPath(source.chapter), prosePath(source.chapter)].includes(change.path)) return change;
  const slots = chapterNameSlots(change.content, change.path).slots;
  if (!slots.length && change.path === prosePath(source.chapter)) {
    const bare = change.content.match(/^(\s*(?:#{1,2}\s+)?第(\d+)章)([ \t]*)(?=\r?\n|$)/);
    if (bare && Number(bare[2]) === source.chapter) return { ...change, content: bare[1] + '：' + source.title + change.content.slice(bare[0].length) };
    const heading = change.content.match(/^(\s*#{1,2}[ \t]+)([^\r\n]+?)([ \t]*)(?=\r?\n|$)/);
    if (heading && !/^第\d+章/.test(heading[2])) return { ...change, content: heading[1] + `第${String(source.chapter).padStart(3, '0')}章：${source.title}` + heading[3] + change.content.slice(heading[0].length) };
  }
  if (slots.length !== 1 || slots[0].chapter !== source.chapter || slots[0].name === source.title) return change;
  const slot = slots[0];
  return { ...change, content: change.content.slice(0, slot.start) + source.title + change.content.slice(slot.end) };
}

export function chapterRenameIssues(run: Run, changes = run.changes): Issue[] {
  const frozen = run.chapterNaming?.renameOnly;
  if (!frozen) return [];
  const issue = (message: string, path?: string): Issue[] => [{ code: 'chapter_rename_scope', severity: 'error', message, ...(path ? { path } : {}) }];
  if (memoryHash(run) !== frozen.memoryHash) return issue('本次只修改章名，不能增删或改写故事记忆');
  for (const document of frozen.documents) if (hash(document.content) !== document.hash) return issue('章名修改依据已改变，请重新发起修改', document.path);
  for (const change of changes) {
    const source = frozen.documents.find(document => document.path === change.path);
    if (!source) return issue('本次只修改章名，不能同时改写其他文稿', change.path);
    const original = chapterNameSlots(source.content, source.path), next = chapterNameSlots(change.content, change.path);
    if (!original.slots.length && change.content === source.content) continue;
    if (!original.slots.length || new Set(original.slots.map(slot => slot.chapter)).size !== original.slots.length || original.skeleton !== next.skeleton)
      return issue('本次只修改章名，请保留章号、剧情、场面与其他字段原文', change.path);
    if (next.slots.some(slot => !meaningful(slot.name))) return issue('请填写完整章节标题', change.path);
  }
  return [];
}

export function chapterTitleIssues(store: FileStore, run: Run, changes = run.changes): Issue[] {
  const source = run.chapterNaming?.source;
  if (!source) return [];
  if (store.db.document(source.path)?.hash !== source.hash || pendingSource(store.db.project(), source.path) || store.inspect(source.path)?.status !== 'accepted')
    return [{ code: 'chapter_title_source', severity: 'error', path: source.path, message: '已确认的章节标题来源发生变化，请重新组装任务' }];
  const issues: Issue[] = [];
  for (const change of changes.filter(change => [taskPath(source.chapter), prosePath(source.chapter)].includes(change.path))) {
    const slots = chapterNameSlots(change.content, change.path).slots;
    if (slots.length !== 1 || slots[0].chapter !== source.chapter || slots[0].name !== source.title)
      issues.push({ code: 'chapter_title_consistency', severity: 'error', path: change.path, message: `请沿用已确认的第${source.chapter}章标题：${source.title}` });
  }
  return issues;
}
