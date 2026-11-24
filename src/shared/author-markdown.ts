import { voicePreferenceSchema } from './quality';

function structuredText(title: string, json: string) {
  try {
    const data = JSON.parse(json);
    if (title === '声音偏好') {
      const preferences = voicePreferenceSchema.array().parse(data.preferences);
      return preferences.map(p => `## ${p.scope.target || '本书叙述'} · ${p.scope.sceneFunction}\n\n${p.statement}${p.exceptions.length ? '\n\n' + p.exceptions.join('；') : ''}`).join('\n\n') || '尚未设置声音偏好';
    }
    const lines: string[] = [];
    const names: Record<string, string> = {
      title: '名称',
      content: '内容',
      goal: '目标',
      obstacle: '阻力',
      choice: '选择',
      outcome: '结果',
      promise: '承诺',
      storyTime: '故事时间',
      scope: '适用范围',
      trigger: '触发条件',
      boundary: '边界',
      cost: '代价',
      exception: '例外',
      evidence: '证据',
      description: '描述',
      name: '图片',
      version: '版本',
      state: '状态',
      chapter: '章节',
      protected: '固定',
      locked: '固定'
    };
    const rows = [
      ...(data.modules ?? []),
      ...(data.scenes ?? []),
      ...(data.places ?? []),
      ...(data.avatars ?? [])
    ];
    if (typeof data.original === 'string' && data.original.trim()) lines.push(data.original);
    for (const row of rows) {
      if (row.state && row.state !== 'enabled' && !row.content && !row.rule) continue;
      lines.push(
        Object.entries({ ...row, ...row.rule })
          .filter(([key, value]) => names[key] && String(value))
          .map(
            ([key, value]) =>
              `${names[key]}：${key === 'state' ? ({ enabled: '启用', disabled: '停用', undecided: '待定' } as Record<string, string>)[String(value)] : typeof value === 'boolean' ? (value ? '是' : '否') : value}`
          )
          .join('\n')
      );
    }
    for (const system of data.systems ?? []) {
      const stageTitle = (id: string) => system.steps.find((step: { id: string }) => step.id === id)?.title ?? '待核对阶段';
      lines.push([
        `成长体系：${system.title} · 第${system.version}版`,
        `状态：${({ enabled: '启用', disabled: '停用', undecided: '未定' } as Record<string, string>)[system.state]}；${system.locked ? '已固定' : '可修改'}`,
        `适用：${system.subjects.join('、') || '未限定人物或阵营'}；第${system.fromChapter}章起${system.toChapter === null ? '' : `，至第${system.toChapter}章`}`,
        ...system.steps.map((step: { title: string; ability: string; boundary: string; prerequisites: string[] }) =>
          `${step.title}：${step.ability || '能力未定'}；${step.boundary || '边界未定'}${step.prerequisites.length ? `；前置：${step.prerequisites.map(stageTitle).join('、')}` : ''}`),
        ...system.interactions.map((item: { targetSystemId: string; rule: string }) =>
          `与${data.systems.find((s: { id: string }) => s.id === item.targetSystemId)?.title ?? '待核对体系'}：${item.rule}`),
        ...(system.original ? [`导入原文：${system.original}`] : []),
        ...(system.unparsed.length ? [`待定内容：${system.unparsed.join('；')}`] : [])
      ].join('\n'));
    }
    const displayName = (id: string) =>
      rows.find((r) => r.id === id)?.title ??
      (/^chapter:\d+$/.test(id)
        ? `第 ${id.split(':')[1]} 章`
        : (rows.find((r) => `scene:${r.id}` === id)?.title ?? '待核对条目'));
    for (const link of [...(data.links ?? []), ...(data.routes ?? [])])
      lines.push(
        `${displayName(link.from)} → ${displayName(link.to)}：${link.label}${link.distance ? ` · ${link.distance.value} ${link.distance.unit}` : 'distance' in link ? ' · 距离未设定' : ''}${link.direction ? ` · ${link.direction}` : ''}${link.nonlinear ? ' · 非线性叙事' : ''}`
      );
    return lines.filter(Boolean).join('\n\n').replace(/<!--[\s\S]*?-->/g, '') || '未设定';
  } catch {
    return '资料暂不可读';
  }
}
// Only application-owned records are reserved. Ordinary Markdown, including author-written code, is verbatim.
const structuredDocument = /^(?:\uFEFF)?# (世界模块|声音偏好|剧情结构|人物外观)[ \t]*\r?\n\s*```json[ \t]*(?:\r?\n|$)/;
const managedBlock = /^(?:(?:## 客户端设置[ \t]*\r?\n(?:[ \t]*\r?\n)*)?```json[ \t]+wenxu-(?:config|book-profile|review)|(?:## 可追溯事实记录[ \t]*\r?\n(?:[ \t]*\r?\n)*)?<!-- wenxu-facts:v1 -->[ \t]*\r?\n(?:[ \t]*\r?\n)*```json)[ \t]*(?:\r?\n|$)[\s\S]*?(?:^```[ \t]*(?:\r?\n|$)|(?![\s\S]))/gm;

const titleDocument = /^# 书名与入口承诺\r?\n\s*此文件由正式记录生成/;
const contractDocument = /^# (?:标签创作契约|作品方案与创作契约)\r?\n\s*此文档由结构化记录生成/;
const narrativeComment = /<!--[ \t]*wenxu-event\b[\s\S]*?(?:-->|(?![\s\S]))/gi;

function readableContract(content: string) {
  return content.replace(/^- (?:标签库|输入版本|输入指纹|方向|依据)：[^\r\n]*(?:\r?\n|$)/gm, '')
    .replace(/^(### [^\r\n]+) · [^\r\n]+$/gm, '$1')
    .replace(/^- [^：\r\n]+：(.*)（标签 [^\r\n]*；范围 (\{[^\r\n]*\})）[ \t]*$/gm, (_, text: string, scope: string) => {
      try {
        const { fromChapter, toChapter } = JSON.parse(scope);
        const chapters = [fromChapter != null && `第${fromChapter}章起`, toChapter != null && `至第${toChapter}章`].filter(Boolean).join('，');
        return '- ' + text + (chapters ? '（' + chapters + '）' : '');
      } catch { return '- ' + text; }
    }).replace(/^- [\w.:-]+：/gm, '- ').replace(/（[^（）\r\n]*；条目 [^（）\r\n]*）(?=\r?$)/gm, '');
}

export function isStructuredMarkdown(content: string) {
  return structuredDocument.test(content) || titleDocument.test(content) || contractDocument.test(content);
}

export function authorMarkdown(content: string): string {
  const header = structuredDocument.exec(content);
  if (header) {
    const body = content.slice(header[0].length);
    const closing = /^```[ \t]*(?:\r?\n|$)/m.exec(body);
    const readable = closing ? structuredText(header[1], body.slice(0, closing.index)) : '资料暂不可读';
    const remaining = closing ? body.slice(closing.index + closing[0].length) : '';
    return '# ' + header[1] + '\n\n' + readable + '\n' + authorMarkdown(remaining);
  }
  if (contractDocument.test(content)) content = readableContract(content);
  if (titleDocument.test(content)) {
    content = content.replace(/^- (?:方案指纹|候选任务)：[^\r\n]*(?:\r?\n|$)/gm, '')
      .replace(/^## 已确认方案依据\r?\n(?:- [^\r\n]*(?:\r?\n|$))*(?:\r?\n)?/m, '');
  }
  if (!/wenxu-/i.test(content)) return content;
  return content.replace(managedBlock, '').replace(narrativeComment, '');
}

/** Keep machine records attached to the reviewed source when the author edits the readable paragraphs. */
export function mergeAuthorMarkdown(original: string, edited: string) {
  if (original === edited || authorMarkdown(original) === edited) return original;
  if (isStructuredMarkdown(original)) throw new Error('请在对应的资料面板中修改结构化资料。');
  const blocks = [...original.matchAll(managedBlock), ...original.matchAll(narrativeComment)]
    .sort((a, b) => a.index! - b.index!);
  if (!blocks.length) return edited;
  const visible = authorMarkdown(original);
  let prefix = 0, suffix = 0;
  while (prefix < Math.min(visible.length, edited.length) && visible[prefix] === edited[prefix]) prefix++;
  while (suffix < Math.min(visible.length, edited.length) - prefix &&
    visible[visible.length - 1 - suffix] === edited[edited.length - 1 - suffix]) suffix++;

  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  let removed = 0, rawEnd = 0, cursor = 0, result = '';
  for (const block of blocks) {
    const anchor = block.index! - removed;
    if (block.index! < rawEnd) continue;
    rawEnd = block.index! + block[0].length;
    let at = anchor === visible.length ? edited.length : anchor <= prefix ? anchor :
      anchor >= visible.length - suffix ? edited.length - (visible.length - anchor) : prefix;
    at = Math.max(at, cursor);
    const inline = /^<!--[ \t]*wenxu-event/i.test(block[0]);
    if (!inline && at > 0 && edited[at - 1] !== '\n') {
      const boundary = edited.indexOf('\n', at);
      at = boundary === -1 ? edited.length : boundary + 1;
    }
    result += edited.slice(cursor, at);
    if (!inline && result && !result.endsWith('\n')) result += newline;
    result += block[0];
    if (!inline && at < edited.length && !result.endsWith('\n')) result += newline;
    removed += block[0].length;
    cursor = at;
  }
  return result + edited.slice(cursor);
}
