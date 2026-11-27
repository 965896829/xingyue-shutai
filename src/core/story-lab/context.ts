import { writingOperation } from '../../shared/writing-operation';
import { labMaterialBlocks, visibleLabMaterial } from '../../shared/lab-material';
import { professionalMethod } from '../creation-policy';
import { describeOperation } from './operation';
import fs from 'node:fs';
import path from 'node:path';
import type { SecretProfile } from '../../shared/types';
import { labMaterialHeadings, labProseAction, type LabGenerate, type LabContext } from '../../shared/story-lab';
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
  let base = input.baseVersionId ? store.version(session.id, input.baseVersionId) :
    input.action === 'discuss' ? store.latestVersion(session.id) : undefined;
  const source = input.sourceVersionId ? store.version(session.id, input.sourceVersionId) : undefined;
  const operation = describeOperation(store, input, session.currentProseId);
  if (input.action === 'continue') {
    if (!source?.partial && !(source?.operation?.action === 'blueprint' && source.operation.scope === 'core'))
      throw new Error('请选择未完成的片段，或继续核心构想第9—17项。');
    base = operation.baseId ? store.version(session.id, operation.baseId) : undefined;
  }
  if (base?.partial && ['revise', 'expand', 'prose'].includes(input.action)) throw new Error('请先继续未完成的原始操作，或编辑已保存片段。');
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
  const prose = labProseAction(input.action, base, source);
  const system = [
    read('system.md'),
    ...(operation.action === 'blueprint' ? [read('blueprint.md')] : []),
    ...(prose ? [professionalMethod(skillRoot, 'prose').content, read('prose.md')] : [])
  ].join('\n\n');
  const sources = ['作者原始要求', ...(session.pins.length ? ['明确保留点'] : [])];
  const target = writingOperation({ project: session.id, chapter: operation.chapter, action: input.action === 'continue' ? 'resume' :
    operation.action === 'prose' ? ({ next: 'next', rewrite: 'rewrite', independent: 'scene', first: 'chapter' } as const)[operation.proseMode ?? 'first'] :
    operation.action === 'revise' ? 'passage' : operation.action, version: operation.baseId,
    previousVersion: input.action === 'continue' ? source?.id : operation.proseMode === 'independent' ? undefined : operation.proseParentId,
    selection: operation.selected && { start: operation.selected.start, end: operation.selected.end } });
  const parts = ['本轮对象：' + JSON.stringify(target),
    `作者原始要求：\n${JSON.stringify(session.requirements, null, 2)}`,
    ...(session.pins.length ? [`明确保留点：\n${session.pins.join('\n')}`] : [])
  ];
  if (base && base.id !== source?.id && (input.action !== 'blueprint' || input.instruction.trim())) {
    const headings = labMaterialHeadings(base.content);
    // A first-chapter draft selects only early-story material by default. The author can change the selection.
    const visible = prose && base.kind === 'blueprint' ? labMaterialBlocks(base.content, base.materialRules)
      .filter(item => visibleLabMaterial(item.rule, operation.chapter ?? 1)) : undefined;
    const indexes = input.sectionIndexes ?? (visible && [...new Set(visible.map(item => item.rule.section))]);
    if (indexes !== undefined) {
      if (!indexes.length && !input.selection)
        throw new Error('请在本次资料中选择相关部分，或选中需要试写的文字；未自动装入远期路线和结局。');
      const excerpts: string[] = [];
      for (const index of [...new Set(indexes)].sort((a, b) => a - b)) {
        const heading = headings[index];
        if (!heading) throw new Error('资料目录已改变，请重新选择');
        // Context checkboxes select the text up to the next heading, not an entire
        // parent subtree that might also contain the ending or discarded material.
        if (visible) {
          const lines = visible.filter(item => item.rule.section === index);
          if (!lines.length && input.sectionIndexes?.includes(index)) throw new Error(`“${heading.title}”不在本章可用资料中，请重新选择。`);
          if (!lines.length) continue;
          excerpts.push(heading.title + '\n' + lines.map(item => item.text).join('') + '\n');
        } else excerpts.push(base.content.slice(heading.start, headings[index + 1]?.start ?? base.content.length));
        sources.push(`${base.title} · ${heading.title}`);
      }
      if (excerpts.length) parts.push(`方案资料（版本 ${base.id}）：\n${excerpts.join('')}`);
    } else {
      parts.push(`本轮参考候选（版本 ${base.id}）：\n${base.content}`);
      sources.push(`${base.title} · 完整版本 ${base.id}`);
    }
  }
  if (input.action === 'prose' && !base) throw new Error('请先选定实验室方案，再试写正文');
  if (operation.action === 'prose' && operation.proseParentId && ['next', 'rewrite'].includes(operation.proseMode ?? '')) {
    const prior = store.version(session.id, operation.proseParentId);
    parts.push('承接正文版本 ' + prior.id + ' · 第' + (prior.operation?.chapter ?? 1) + '章。根据原文核对持有物、伤势、承诺、未完行动与章末悬念。\n' + prior.content);
    sources.push('前章正文 · ' + prior.id);
  }
  if (operation.selected && input.action === 'continue') parts.push('原始选区 ' + operation.selected.start + '—' + operation.selected.end + '：\n' + operation.selected.text);
  if (input.selection) {
    parts.push(`当前选中原文：\n${input.selection.text}`);
    sources.push('作者选中的原文');
  }
  if (input.concealed) {
    parts.push(`本场不应提前揭示的信息：\n${input.concealed}`);
    sources.push('不提前揭示的信息');
  }
  {

    const selected =
      input.recentMessageIds === undefined
        ? operation.proseMode === 'independent' ? [] : store.discussions(session.id)
        : input.recentMessageIds.map((id) => {
            const message = store.get('messages', id);
            if (!message || message.sessionId !== session.id) throw new Error('讨论消息不属于此实验');
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
    parts.push('原始任务：' + JSON.stringify(operation), operation.segment === 'tail' ? '已写核心构想第1—8项，按原模板完成第9—17项；从保存位置接续。' : '准确接续原片段最后一个字符。');
    parts.push(
      `已生成内容（完整保留，只追加新片段）：\n${source!.content}`,
      `中断位置：原文末尾，第 ${source!.content.length} 个字符。`
    );
    sources.push(`继续来源 ${source!.title} · ${source!.id}`);
  }
  const directive = {
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
  parts.push(`本次操作：${directive}\n作者本轮要求：${input.instruction}`);
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
    baseVersionId: base?.id ?? null,
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
