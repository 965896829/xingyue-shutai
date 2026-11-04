import fs from 'node:fs';
import path from 'node:path';
import type { SecretProfile } from '../../shared/types';
import { labHeadings, type LabGenerate, type LabContext } from '../../shared/story-lab';
import { assertRequestFits } from '../context-budget';
import { requestBody } from '../provider';
import { fingerprint } from '../runtime/canonical';
import type { LabStore } from './store';

export function labProfile(profile: SecretProfile, outputLimit: number): SecretProfile {
  return {
    ...structuredClone(profile),
    outputLimit: Math.min(outputLimit, profile.outputLimit),
    stream: true,
    // The lab sends independent long responses. Use HTTP/SSE from the outset:
    // the local relay's WS upstream closed twice after ~120s without events.
    // This is a request snapshot, not a settings write or a charged fallback.
    ...(profile.protocol === 'responses' ? { responsesTransport: 'http' as const } : {}),
    tools: false,
    networkRecovery: { ...profile.networkRecovery, maxRetries: 0, retryUnknown: false }
  };
}
export function buildLabContext(
  store: LabStore,
  skillRoot: string,
  input: LabGenerate,
  profile: SecretProfile
): LabContext {
  const session = store.session(input.sessionId);
  const base = input.baseVersionId ? store.version(session.id, input.baseVersionId) : undefined;
  const source = input.sourceVersionId ? store.version(session.id, input.sourceVersionId) : undefined;
  if (input.action !== 'blueprint' && !input.instruction.trim())
    throw new Error('请说明这次要讨论、修改、展开或试写什么');
  if (input.action === 'revise') {
    if (
      !base ||
      !input.selection ||
      input.selection.end <= input.selection.start ||
      base.content.slice(input.selection.start, input.selection.end) !== input.selection.text
    )
      throw new Error('选区与基准版本不一致，请重新选择原文');
  }
  if (input.action === 'continue' && !source) throw new Error('请选择需要继续的生成版本');
  const read = (file: string) => fs.readFileSync(path.join(skillRoot, 'story-lab', file), 'utf8');
  const prose =
    input.action === 'prose' ||
    (input.action === 'continue' && source?.kind === 'prose') ||
    (input.action === 'revise' && base?.kind === 'prose');
  const system = [
    read('system.md'),
    ...(input.action === 'blueprint' ? [read('blueprint.md')] : []),
    ...(prose ? [read('prose.md')] : [])
  ].join('\n\n');
  const sources = ['作者原始要求', ...(session.pins.length ? ['明确保留点'] : [])];
  const parts = [
    `作者原始要求：\n${JSON.stringify(session.requirements, null, 2)}`,
    ...(session.pins.length ? [`明确保留点：\n${session.pins.join('\n')}`] : [])
  ];
  if (input.action !== 'blueprint' && base) {
    const headings = labHeadings(base.content);
    // A first-chapter draft selects only early-story material by default. The author can change the selection.
    const indexes =
      input.sectionIndexes ??
      (prose
        ? headings.flatMap((h, i) =>
            /核心设定|主角|独特优势|核心人物|群像|开篇|人物表现|文风|作品声音/.test(h.title) ? [i] : []
          )
        : undefined);
    if (indexes !== undefined) {
      if (!indexes.length && !input.selection)
        throw new Error('请在本次资料中选择相关部分，或选中需要试写的文字；未自动装入远期路线和结局。');
      for (const index of [...new Set(indexes)]) {
        const heading = headings[index];
        if (!heading) throw new Error('资料目录已改变，请重新选择');
        // Context checkboxes select the text up to the next heading, not an entire
        // parent subtree that might also contain the ending or discarded material.
        parts.push(
          `方案资料（版本 ${base.id}）：\n${base.content.slice(heading.start, headings[index + 1]?.start ?? base.content.length)}`
        );
        sources.push(`${base.title} · ${heading.title}`);
      }
    } else {
      parts.push(`当前方案（版本 ${base.id}）：\n${base.content}`);
      sources.push(`${base.title} · 完整版本 ${base.id}`);
    }
  }
  if (input.action === 'prose' && !base) throw new Error('请先选定实验室方案，再试写正文');
  if (input.selection) {
    parts.push(`当前选中原文：\n${input.selection.text}`);
    sources.push('作者选中的原文');
  }
  if (input.concealed) {
    parts.push(`本场不应提前揭示的信息：\n${input.concealed}`);
    sources.push('不提前揭示的信息');
  }
  if (input.action !== 'blueprint') {
    const messages = store.all('messages', session.id);
    const selected =
      input.recentMessageIds === undefined
        ? messages.filter((m) => m.action === 'discuss').slice(-6)
        : input.recentMessageIds.map((id) => {
            const message = messages.find((m) => m.id === id);
            if (!message) throw new Error('讨论消息不属于此实验');
            return message;
          });
    if (selected.length) {
      parts.push(
        '作者选择的近期讨论：\n' +
          selected.map((m) => `${m.role === 'user' ? '作者' : '伙伴'}：${m.content}`).join('\n\n')
      );
      sources.push(...selected.map((m) => `讨论 ${m.id}`));
    }
  }
  if (input.action === 'continue') {
    parts.push(
      `已生成内容（完整保留，只追加新片段）：\n${source!.content}`,
      `中断位置：原文末尾，第 ${source!.content.length} 个字符；末尾原文：\n${source!.content.slice(-800)}`
    );
    sources.push(`继续来源 ${source!.title} · ${source!.id}`);
  }
  const operation = {
    blueprint:
      input.blueprintScope === 'core'
        ? '本次生成核心构想：目录第1—8项。长篇展开将在作者主动继续后另行生成，不提前省略核心设计。'
        : '生成一套完整且连贯的作品构想。',
    discuss: '直接与作者讨论，提出具体候选。不要自行重写整份方案。',
    revise:
      '只输出选中原文的替换候选，保留需要的Markdown标题，不附解释，不重抄未选部分。相关部分如有冲突，留待作者另行同步调整。',
    expand: '按作者指定范围展开，输出该范围的独立候选，不重写无关部分。',
    prose: '完成作者指定的小说正文，只交付正文。',
    continue: '从中断处接着写，仅输出新片段，不重写、复述或补抄前文，继续范围服从作者本轮要求。'
  }[input.action];
  parts.push(`本次操作：${operation}\n作者本轮要求：${input.instruction}`);
  const user = parts.join('\n\n');
  const sizing = assertRequestFits(
    profile,
    requestBody(profile, system, [{ role: 'user', content: user }], []).body,
    0
  );
  return {
    system,
    user,
    sources,
    baseVersionId: input.baseVersionId,
    estimatedInput: sizing.tokens,
    availableInput: sizing.availableInput,
    outputLimit: profile.outputLimit,
    requestCount: 1,
    warning:
      input.action === 'blueprint' && profile.outputLimit < 8192
        ? '当前输出上限可能不足以展开完整构想。可选择先生成第1—8项，再主动继续第9—17项；共预计2次请求。不会自动发送第二次。'
        : '',
    fingerprint: fingerprint({
      system,
      user,
      profileId: profile.id,
      version: profile.version,
      outputLimit: profile.outputLimit
    })
  };
}
