import type { FileStore } from './storage';
import type { CanonicalSnapshot, MemoryScope, SourceRef } from '../shared/studio';
import type { Change, Fact } from '../shared/types';
import {
  plotDocumentSchema,
  plotMutationSchema,
  type PlotDocument,
  type PlotNode,
  type PlotView
} from '../shared/workbench-visual';
import { chapterSpan } from './context-slices';
import { paths, hash, detailPath } from './domain';
import { pendingSource } from './memory-source';

export const plotPath = '05_长篇大纲/剧情结构.md';
const clean = (s: string) => s.replace(/\*\*|`/g, '').trim();
const cellsOf = (line: string) =>
  line
    .trim()
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map(clean);
const blank = { goal: '', obstacle: '', choice: '', outcome: '', promise: '', storyTime: '' };
const labels = {
  goal: ['目标', '主角目标', '场景目标', '主角动作'],
  obstacle: ['阻力', '核心冲突', '外部推动', '障碍'],
  choice: ['选择', '人物选择', '主角选择', '策略'],
  outcome: ['结果', '状态变化', '阶段回报', '变化'],
  promise: ['承诺', '阅读回报', '章末牵引', '结尾悬念'],
  storyTime: ['故事时间', '时间']
} as const;
const fields = (values: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(labels).map(([field, names]) => [
      field,
      names
        .map((name) => values[name])
        .find(Boolean)
        ?.slice(0, 12000) ?? ''
    ])
  ) as typeof blank;
export function boundSource(
  path: string,
  content: string,
  start: number,
  end: number,
  snapshotId?: string
): SourceRef {
  return {
    path,
    hash: hash(content),
    quote: content.slice(start, end),
    start: Array.from(content.slice(0, start)).length,
    end: Array.from(content.slice(0, end)).length,
    ...(snapshotId ? { snapshotId } : {})
  };
}
export function parsePlotDocument(content: string): PlotDocument {
  const match = content.match(/^# 剧情结构\s+```json\s*([\s\S]*?)```\s*$/);
  if (!match) throw new Error('剧情结构格式不完整');
  const result = plotDocumentSchema.parse(JSON.parse(match[1]));
  const rows = [...result.scenes, ...result.links];
  if (new Set(rows.map((r) => r.id)).size !== rows.length) throw new Error('剧情结构标识重复');
  return result;
}
export function renderPlotDocument(document: PlotDocument) {
  const output = `# 剧情结构\n\n\`\`\`json\n${JSON.stringify(document, null, 2)}\n\`\`\`\n`;
  parsePlotDocument(output);
  return output;
}
export interface ChapterBlock {
  chapter: number;
  start: number;
  end: number;
  labelStart: number;
  labelEnd: number;
  label: string;
  title: string;
  values: Record<string, string>;
}
export function chapterBlocks(content: string): ChapterBlock[] {
  const lines = [...content.matchAll(/[^\r\n]*(?:\r?\n|$)/g)].filter((m) => m[0]);
  const blocks: ChapterBlock[] = [];
  let header: string[] = [],
    column = -1,
    fence = '';
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i],
      line = match[0],
      offset = match.index!;
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      fence = fence ? '' : marker[1][0];
      continue;
    }
    if (fence) continue;
    if (/^\s*\|/.test(line)) {
      const cells = cellsOf(line);
      const at = cells.findIndex((v) => /^(?:章节|章次|章号)$/.test(v));
      if (at >= 0) {
        header = cells;
        column = at;
        continue;
      }
      if (column < 0 || cells.every((v) => /^:?-+:?$/.test(v))) continue;
      const value = cells[column],
        span = chapterSpan(value ?? '', true);
      if (!span || span[0] !== span[1]) continue;
      const pipe = [...line.matchAll(/(?<!\\)\|/g)].map((v) => v.index!);
      const rawStart = pipe[column] + 1,
        rawEnd = pipe[column + 1];
      const raw = line.slice(rawStart, rawEnd),
        token = raw.trim();
      const start = rawStart + raw.indexOf(token);
      const values = Object.fromEntries(header.map((v, n) => [v, cells[n] ?? '']));
      blocks.push({
        chapter: span[0],
        start: offset,
        end: offset + line.length,
        labelStart: offset + start,
        labelEnd: offset + start + token.length,
        label: token,
        title: values['章名'] || values['标题'] || `第 ${span[0]} 章`,
        values
      });
      continue;
    }
    if (line.trim()) {
      header = [];
      column = -1;
    }
    const heading = line.match(
      /^(#{1,6})\s+(第\s*[零〇一二两三四五六七八九十百千万\d]+\s*章)(?!\s*[—–\-~～至到])([^\r\n]*)/
    );
    const span = heading && chapterSpan(heading[2]);
    if (!heading || !span) continue;
    let end = content.length;
    for (let j = i + 1; j < lines.length; j++) {
      const next = lines[j][0].match(/^(#{1,6})\s/);
      if (next && next[1].length <= heading[1].length) {
        end = lines[j].index!;
        break;
      }
    }
    const values: Record<string, string> = {};
    for (const field of content
      .slice(offset + line.length, end)
      .matchAll(/^\s*[-*]\s*([^：:\n]+)[：:]\s*(.+)$/gm))
      values[clean(field[1])] = clean(field[2]);
    const start = offset + line.indexOf(heading[2]);
    blocks.push({
      chapter: span[0],
      start: offset,
      end,
      labelStart: start,
      labelEnd: start + heading[2].length,
      label: heading[2],
      title: heading[3].replace(/^[\s：:·—-]+/, '') || `第 ${span[0]} 章`,
      values
    });
  }
  return blocks;
}
function renamedLabel(label: string, chapter: number) {
  if (/^\d+$/.test(label)) return String(chapter).padStart(label.length, '0');
  const digits = label.match(/\d+/)?.[0];
  return `第${digits ? String(chapter).padStart(digits.length, '0') : chapter}章`;
}
export function reorderPlanText(content: string, before: number[], after: number[]): string {
  const blocks = chapterBlocks(content).filter((b) => before.includes(b.chapter));
  if (!blocks.length) return content;
  if (new Set(blocks.map((b) => b.chapter)).size !== blocks.length)
    throw new Error('同一文稿含重复章节，请先明确章节结构');
  const map = new Map(blocks.map((b) => [b.chapter, b]));
  const ordered = [...blocks].sort((a, b) => a.start - b.start);
  if (ordered.some((block, i) => i > 0 && block.start < ordered[i - 1].end))
    throw new Error('章节标题存在嵌套，请先明确章节结构');
  const edits: { start: number; end: number; value: string }[] = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    const target = map.get(before[i]),
      source = map.get(after[i]);
    if (!target && !source) continue;
    if (!target || !source) throw new Error('文稿只覆盖部分调序章节，请先补齐对应计划或缩小范围');
    const value =
      content.slice(source.start, source.labelStart) +
      renamedLabel(source.label, before[i]) +
      content.slice(source.labelEnd, source.end);
    edits.push({ start: target.start, end: target.end, value });
  }
  for (const edit of edits.sort((a, b) => b.start - a.start))
    content = content.slice(0, edit.start) + edit.value + content.slice(edit.end);
  return content;
}
function read(store: FileStore, snapshot: CanonicalSnapshot, file: string, current: boolean) {
  const digest = snapshot.documents[file];
  if (digest && current && store.inspect(file)?.status !== 'accepted')
    throw new Error('剧情来源存在未确认改动');
  return digest && !pendingSource(snapshot.project, file) ? store.object(digest).toString('utf8') : undefined;
}
export function knownPlotChapters(documents: Record<string, string>, outline = '', document?: PlotDocument) {
  return [
    ...new Set([
      ...chapterBlocks(outline).map((b) => b.chapter),
      ...Object.keys(documents).flatMap((file) =>
        /^0[67]_/.test(file) && !/第\d+-\d+章/.test(file)
          ? [Number(file.match(/第(\d+)章/)?.[1])].filter(Boolean)
          : []
      ),
      ...(document?.scenes.map((s) => s.chapter) ?? [])
    ])
  ].sort((a, b) => a - b);
}
export function readPlot(
  store: FileStore,
  snapshot: CanonicalSnapshot,
  scope: MemoryScope,
  editable: boolean,
  facts: Fact[],
  expandedChapter = scope.chapter
): PlotView {
  const author =
    scope.viewpoint === 'author' &&
    scope.chapter >= snapshot.project.chapter &&
    scope.worldId === 'main' &&
    scope.timelineId === 'main';
  const stored = author ? read(store, snapshot, plotPath, scope.mode === 'current') : undefined;
  const document = stored ? parsePlotDocument(stored) : { version: 1 as const, scenes: [], links: [] };
  const outline = author ? (read(store, snapshot, paths.outline, scope.mode === 'current') ?? '') : '';
  const blocks = chapterBlocks(outline);
  const nodes: PlotNode[] = [
    {
      ...blank,
      id: 'project',
      parentId: null,
      level: 'project',
      title: snapshot.project.title,
      sources: [],
      track: 'saved',
      editable: false
    }
  ];
  const volumes: {
    id: string;
    title: string;
    from: number;
    to: number;
    source: SourceRef;
    values?: Record<string, string>;
  }[] = [];
  const volumeText = author ? read(store, snapshot, paths.volumes, scope.mode === 'current') : undefined;
  if (volumeText) {
    let headers: string[] = [];
    for (const line of volumeText.matchAll(/[^\r\n]+/g)) {
      if (!/^\s*\|/.test(line[0])) continue;
      const cells = cellsOf(line[0]);
      if (cells.includes('章节范围') || cells.includes('覆盖章节')) {
        headers = cells;
        continue;
      }
      const values = Object.fromEntries(headers.map((k, i) => [k, cells[i] ?? '']));
      const span = chapterSpan(values['章节范围'] || values['覆盖章节'] || '', true);
      if (!span) continue;
      const title =
        [values['卷数'] || values['卷序'], values['卷名']].filter(Boolean).join(' · ') ||
        `第 ${volumes.length + 1} 卷`;
      volumes.push({
        id: `volume:${hash(`${title}:${span[0]}:${span[1]}`).slice(0, 16)}`,
        title,
        from: span[0],
        to: span[1],
        source: boundSource(
          paths.volumes,
          volumeText,
          line.index!,
          line.index! + line[0].length,
          snapshot.id
        ),
        values
      });
    }
    if (!volumes.length) {
      for (const match of volumeText.matchAll(
        /^#{1,4}\s+(第[^\r\n]+卷[^\r\n]*)\r?\n([\s\S]*?)(?=^#{1,4}\s|$(?![\s\S]))/gm
      )) {
        const range = match[2].match(/(?:章节范围|覆盖章节|起止章节)[：:]\s*([^\r\n]+)/)?.[1];
        const span = range && chapterSpan(clean(range), true);
        if (span)
          volumes.push({
            id: `volume:${hash(match[1]).slice(0, 16)}`,
            title: match[1],
            from: span[0],
            to: span[1],
            source: boundSource(
              paths.volumes,
              volumeText,
              match.index!,
              match.index! + match[0].length,
              snapshot.id
            ),
            values: Object.fromEntries(
              [...match[2].matchAll(/^\s*[-*]\s*([^：:\n]+)[：:]\s*(.+)$/gm)].map((m) => [
                clean(m[1]),
                clean(m[2])
              ])
            )
          });
      }
    }
  }
  for (const volume of volumes)
    nodes.push({
      ...fields(volume.values ?? {}),
      id: volume.id,
      parentId: 'project',
      level: 'volume',
      title: volume.title,
      chapter: volume.from,
      endChapter: volume.to,
      sources: [volume.source],
      track: 'plan',
      editable: false
    });
  const chapters = author
    ? knownPlotChapters(snapshot.documents, outline, document)
    : [...new Set(facts.map((f) => f.fromChapter).filter((n) => n > 0))].sort((a, b) => a - b);
  for (const number of chapters) {
    const matching = volumes.filter((v) => v.from <= number && v.to >= number);
    const volume = matching.length === 1 ? matching[0].id : 'volume:unassigned';
    if (volume === 'volume:unassigned' && !nodes.some((n) => n.id === volume))
      nodes.push({
        ...blank,
        id: volume,
        parentId: 'project',
        level: 'volume',
        title: '未分卷',
        sources: [],
        track: 'plan',
        editable: false
      });
    const block = blocks.find((b) => b.chapter === number);
    const sources = block
      ? [
          boundSource(
            paths.outline,
            outline,
            block.start,
            Math.min(block.end, block.start + 18000),
            snapshot.id
          )
        ]
      : [];
    const prose = Object.keys(snapshot.documents).find(
      (file) => /^07_/.test(file) && Number(file.match(/第(\d+)章/)?.[1]) === number
    );
    if (author && prose)
      sources.push({ path: prose, hash: snapshot.documents[prose], quote: '', snapshotId: snapshot.id });
    nodes.push({
      ...fields(block?.values ?? {}),
      id: `chapter:${number}`,
      parentId: volume,
      level: 'chapter',
      title: block?.title ?? `第 ${number} 章`,
      chapter: number,
      sources,
      track: prose ? 'saved' : 'plan',
      editable: editable && author
    });
  }
  if (author) {
    for (const scene of document.scenes) {
      const { id, protected: fixed, ...values } = scene;
      const token = `"id": ${JSON.stringify(id)}`,
        start = stored?.indexOf(token) ?? -1;
      nodes.push({
        ...values,
        id: `scene:${id}`,
        sceneId: id,
        parentId: `chapter:${scene.chapter}`,
        level: 'scene',
        track: 'plan',
        editable,
        sources:
          stored && start >= 0
            ? [boundSource(plotPath, stored, start, start + token.length, snapshot.id)]
            : []
      });
    }
    const file = detailPath(expandedChapter),
      detail = read(store, snapshot, file, scope.mode === 'current');
    if (detail) {
      const sceneHeadings = [...detail.matchAll(/^#{2,6}\s+(?:场景|场次)\s*([^\r\n]+)\r?\n/gm)];
      for (let i = 0; i < sceneHeadings.length; i++) {
        const heading = sceneHeadings[i],
          start = heading.index!,
          end = sceneHeadings[i + 1]?.index ?? detail.length;
        const values = Object.fromEntries(
          [...detail.slice(start, end).matchAll(/^\s*[-*]\s*([^：:\n]+)[：:]\s*(.+)$/gm)].map((v) => [
            clean(v[1]),
            clean(v[2])
          ])
        );
        nodes.push({
          ...fields(values),
          id: `legacy-scene:${expandedChapter}:${hash(heading[1]).slice(0, 16)}`,
          parentId: `chapter:${expandedChapter}`,
          level: 'scene',
          title: `场景 ${heading[1]}`,
          chapter: expandedChapter,
          sources: [boundSource(file, detail, start, Math.min(end, start + 18000), snapshot.id)],
          track: 'plan',
          editable: false
        });
      }
    }
  } else {
    for (const fact of facts.filter(
      (f) => ['timeline', 'promise', 'hook'].includes(f.category) && f.fromChapter > 0
    ))
      nodes.push({
        ...blank,
        id: `scene:fact:${fact.id}`,
        parentId: `chapter:${fact.fromChapter}`,
        level: 'scene',
        title: fact.subject,
        chapter: fact.fromChapter,
        outcome: fact.value,
        storyTime: fact.storyTime,
        sources: fact.evidence.map((e) => ({ ...e, snapshotId: snapshot.id })),
        track: 'saved',
        editable: false
      });
  }
  const ids = new Set(nodes.map((n) => n.id));
  return {
    nodes,
    links: author ? document.links.filter((l) => ids.has(l.from) && ids.has(l.to)) : [],
    baseHash: author ? (snapshot.documents[plotPath] ?? null) : null,
    document: author ? document : null
  };
}
export function mutatePlot(store: FileStore, baseHash: string | null, raw: unknown) {
  if ((store.db.document(plotPath)?.hash ?? null) !== baseHash) throw new Error('剧情结构已变化，请刷新');
  const document = baseHash
    ? parsePlotDocument(store.readAccepted(plotPath).content)
    : { version: 1 as const, scenes: [], links: [] };
  const mutation = plotMutationSchema.parse(raw);
  if (mutation.kind === 'scene') {
    const previous = document.scenes.find((s) => s.id === mutation.scene.id);
    if (
      previous?.protected &&
      mutation.scene.protected &&
      JSON.stringify(previous) !== JSON.stringify(mutation.scene)
    )
      throw new Error('请先解除场景固定');
    document.scenes = [...document.scenes.filter((s) => s.id !== mutation.scene.id), mutation.scene];
  } else if (mutation.kind === 'deleteScene') {
    if (document.scenes.find((s) => s.id === mutation.id)?.protected) throw new Error('请先解除场景固定');
    if (document.links.some((l) => l.from === `scene:${mutation.id}` || l.to === `scene:${mutation.id}`))
      throw new Error('请先处理此场景的因果连接');
    document.scenes = document.scenes.filter((s) => s.id !== mutation.id);
  } else if (mutation.kind === 'link')
    document.links = [...document.links.filter((l) => l.id !== mutation.link.id), mutation.link];
  else document.links = document.links.filter((l) => l.id !== mutation.id);
  const change = { path: plotPath, content: renderPlotDocument(document), baseHash };
  validatePlotChanges(store, [change], true);
  return change;
}
export function validatePlotChanges(store: FileStore, changes: Change[], allowUnlock = false) {
  const change = changes.find((c) => c.path === plotPath);
  if (!change) return;
  const doc = parsePlotDocument(change.content);
  if (store.db.document(plotPath)?.hash) {
    const previous = parsePlotDocument(store.readAccepted(plotPath).content);
    for (const scene of previous.scenes.filter((s) => s.protected)) {
      const next = doc.scenes.find((s) => s.id === scene.id);
      if (
        !next ||
        (JSON.stringify(next) !== JSON.stringify(scene) &&
          !(
            allowUnlock &&
            next.protected === false &&
            JSON.stringify({ ...next, protected: true }) === JSON.stringify(scene)
          ))
      )
        throw new Error('请先解除场景固定');
    }
  }
  const documents: Record<string, string> = Object.fromEntries(
    store.db
      .acceptedDocuments()
      .filter((d) => d.hash)
      .map((d) => [d.path, d.hash!])
  );
  for (const c of changes) documents[c.path] = hash(c.content);
  const outline =
    changes.find((c) => c.path === paths.outline)?.content ??
    (documents[paths.outline] ? store.readAccepted(paths.outline).content : '');
  const ids = new Set([
    'project',
    ...knownPlotChapters(documents, outline, doc).map((n) => `chapter:${n}`),
    ...doc.scenes.map((s) => `scene:${s.id}`)
  ]);
  for (const link of doc.links)
    if (link.from === link.to || !ids.has(link.from) || !ids.has(link.to))
      throw new Error('剧情连接指向不存在的章或场景');
}
export function plotContext(content: string, chapter: number) {
  const doc = parsePlotDocument(content);
  const scenes = doc.scenes.filter((s) => s.chapter === chapter);
  const ids = new Set([`chapter:${chapter}`, ...scenes.map((s) => `scene:${s.id}`)]);
  return JSON.stringify({
    chapter,
    scenes,
    links: doc.links.filter((l) => ids.has(l.from) || ids.has(l.to))
  });
}
export function plotAffectedChapters(before: string | undefined, after: string) {
  const previous = before ? parsePlotDocument(before) : { version: 1 as const, scenes: [], links: [] },
    next = parsePlotDocument(after);
  const chapters = new Set<number>();
  const add = (id: string) => {
    if (/^chapter:\d+$/.test(id)) chapters.add(Number(id.slice(8)));
    for (const doc of [previous, next]) {
      const scene = doc.scenes.find((s) => `scene:${s.id}` === id);
      if (scene) chapters.add(scene.chapter);
    }
  };
  for (const doc of [previous, next])
    for (const scene of doc.scenes) {
      const other = (doc === previous ? next : previous).scenes.find((s) => s.id === scene.id);
      if (JSON.stringify(scene) !== JSON.stringify(other)) {
        chapters.add(scene.chapter);
        if (other) chapters.add(other.chapter);
      }
    }
  for (const doc of [previous, next])
    for (const link of doc.links)
      if (
        JSON.stringify(link) !==
        JSON.stringify((doc === previous ? next : previous).links.find((l) => l.id === link.id))
      ) {
        add(link.from);
        add(link.to);
      }
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const link of next.links) {
      const from = /^chapter:\d+$/.test(link.from)
        ? Number(link.from.slice(8))
        : next.scenes.find((s) => `scene:${s.id}` === link.from)?.chapter;
      const to = /^chapter:\d+$/.test(link.to)
        ? Number(link.to.slice(8))
        : next.scenes.find((s) => `scene:${s.id}` === link.to)?.chapter;
      if (from && to && chapters.has(from) && !chapters.has(to)) {
        chapters.add(to);
        expanded = true;
      }
    }
  }
  return [...chapters].sort((a, b) => a - b);
}
