import { activeBatch, chapterTag, paths, updatePath } from './domain';
import type { Change, ProjectState } from '../shared/types';

/** Applied only inside an approved chapter commit; never alters story or review findings. */
export function materializeAftermathStatus(changes: Change[], project: ProjectState) {
  const report = changes.find(change => change.path === updatePath(project.chapter));
  if (!report) return [];
  const has = (file: string) => changes.some(change => change.path === file);
  const batch = activeBatch(project), edits: string[] = [];
  const fields: Record<string, string> = {
    已同步角色卡当前字段: has(paths.roles) ? '是' : '无变化（保留原状态）',
    已追加情绪与行为记忆: has(paths.behavior) ? '是' : '否',
    已更新人物关系: has(paths.relations) ? '是' : '无变化',
    已更新批次人物摘要: project.chapter === batch.end ? (has(paths.summary) ? '是' : '否') : '未到批次边界',
    已更新连续性台账: [paths.timeline, paths.hooks, paths.items, paths.terms, paths.knowledge].some(has) ? '是' : '无变化',
    已更新阶段索引: '是',
    已更新当前进度: '是'
  };
  let syncSection = false, fence = '';
  report.content = report.content.split(/\r?\n/).map(line => {
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''; return line; }
    if (fence) return line;
    const section = line.match(/^##\s+(.+?)\s*$/);
    if (section) syncSection = section[1] === '同步检查';
    if (!syncSection) return line;
    const field = line.match(/^[-*+]\s+(?:\*\*)?([^：:]+?)(?:\*\*)?[：:]\s*(.*)$/);
    if (!field || !(field[1] in fields)) return line;
    const replacement = `- ${field[1]}：${fields[field[1]]}`;
    if (line !== replacement) edits.push(field[1]);
    return replacement;
  }).join(report.content.includes('\r\n') ? '\r\n' : '\n');
  return edits;
}

/** Progress is metadata, not a claim that an unfinished batch already has a summary. */
export function batchSummaryProgress(content: string, project: ProjectState) {
  const batch = activeBatch(project);
  // Keep the initialization text as history; it must not claim to be the current
  // state after the first accepted chapter. Never rewrite character/batch fields.
  const firstSection = content.search(/^##\s/m);
  const preambleEnd = firstSection < 0 ? content.length : firstSection;
  let fence = '';
  const preamble = content.slice(0, preambleEnd).split(/(\r?\n[\t ]*\r?\n)/).map(paragraph => {
    let fenced = Boolean(fence);
    for (const text of paragraph.split(/\r?\n/)) {
      const marker = text.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
      if (!marker) continue;
      fenced = true;
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = '';
    }
    if (fenced) return paragraph;
    if (/^\s*(?:[#>|]|[-*+]\s|`{3,}|~{3,}|正文开始前的初始化记录[：:])/.test(paragraph)) return paragraph;
    const initialStatus = /(?:正文(?:已)?完成|已完成正文|正文进度)[：:\s]*(?:0|零)\s*章|(?:当前|本)批次尚未(?:发生|开始)/u;
    return initialStatus.test(paragraph) ? `正文开始前的初始化记录：${paragraph}` : paragraph;
  }).join('');
  content = preamble + content.slice(preambleEnd);
  const line = `- 当前批次进度：${chapterTag(project.chapter)}已完成（${project.chapter - batch.start + 1}/${batch.end - batch.start + 1}）；未到批次边界，完整批次摘要将在本批结束后生成。`;
  if (/^- 当前批次进度[：:]/m.test(content)) return content.replace(/^- 当前批次进度[：:][^\r\n]*/m, line);
  const title = content.match(/^# [^\r\n]+\r?\n/);
  return title ? content.replace(title[0], title[0] + '\n' + line + '\n') : line + '\n\n' + content;
}
