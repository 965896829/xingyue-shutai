import { createHash } from 'node:crypto';
type WireItem = Record<string, any>;
const ruleVersion = (content: string) => createHash('sha256').update(content).digest('hex').slice(0, 20);
/** Host-owned instruction blocks only; user/source content never goes through this parser. */
export const sharedRuleBlock = (key: string, content: string) => content
  ? `\n<wenxu-shared-rule key="${key}" version="${ruleVersion(content)}">\n${content}\n</wenxu-shared-rule>\n` : '';
export function splitSharedRules(system: string) {
  const rules: string[] = [];
  const remaining = system.replace(/<wenxu-shared-rule key="([a-z0-9-]+)" version="([a-f0-9]{20})">\n([\s\S]*?)\n<\/wenxu-shared-rule>/g, (block, _key, version, content) => {
    if (version !== ruleVersion(content)) return block;
    rules.push(block); return '';
  });
  return { rules, remaining };
}
const message = (role: 'developer' | 'user', text: string, breakpoint = false): WireItem => ({ role, content: [{
  type: 'input_text', text, ...(breakpoint ? { prompt_cache_breakpoint: { mode: 'explicit' } } : {})
}] });

/** Deterministic wire layout only. Stored assistant/tool history is never edited.
 * Source text remains user data, even when it precedes the stage instruction. */
export function cacheableInput(system: string, input: WireItem[], explicit = true) {
  const focused = system.includes('<wenxu-stage-focus ');
  const boundary = system.indexOf('\n--- 当前专项技能：');
  const common = boundary > 0 ? system.slice(0, boundary) : system;
  const { remaining: stage, rules } = splitSharedRules(boundary > 0 ? system.slice(boundary) : '');
  const prefix = [message('developer', common, explicit)];
  const first = input[0];
  let payload: Record<string, any> | undefined;
  try {
    const parsed = first?.role === 'user' && typeof first.content === 'string' ? JSON.parse(first.content) : null;
    if (parsed && typeof parsed === 'object' && typeof parsed.contextPolicy === 'string' &&
        Object.hasOwn(parsed, 'authorPremise') && Array.isArray(parsed.sources) &&
        parsed.sources.every((s: any) => s && typeof s.path === 'string' && typeof s.hash === 'string' && typeof s.content === 'string')) payload = parsed;
  } catch { /* Ordinary chat content is not a host context envelope. */ }
  if (payload) {
    const { authorPremise, sources, ...dynamic } = payload;
    // The same path/hash/mode/required manifest was previously serialized twice.
    // Retain its identity and fact bindings; reference the exact source metadata
    // only when every entry is proven identical. Diagnostic envelopes stay intact.
    const manifest = dynamic.context_manifest;
    if (Array.isArray(manifest?.sources) && manifest.sources.length === sources.length &&
        manifest.sources.every((s: any, i: number) => ['path', 'hash', 'required', 'mode'].every(k => s[k] === sources[i][k]))) {
      const { sources: _duplicate, ...identity } = manifest;
      dynamic.context_manifest = { ...identity, sources_ref: '本消息 sources 中各项的 path/hash/required/mode；同一来源清单，不重复列出。' };
    }
    if (focused) {
      if (stage) prefix.push(message('developer', stage));
      prefix.push(...rules.map(rule => message('developer', rule)));
    }
    prefix.push(message('user', JSON.stringify({ authorPremise }), explicit));
    const sourceItems = [...sources].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    // Source content is present exactly once; per-task selection metadata follows.
    for (let i = 0; i < sourceItems.length; i++) {
      const s = sourceItems[i];
      prefix.push(message('user', JSON.stringify({ source: { path: s.path, hash: s.hash, content: s.content, mode: s.mode, ranges: s.ranges, category: s.category } }), explicit && i === sourceItems.length - 1));
    }
    // All phases share the premise and authoritative files, while even a
    // "shared" rule may be absent or different in prose/review/memory mode.
    // Keep those variable blocks after the data so a role or rule change does
    // not invalidate the unchanged source prefix. Roles and text stay intact.
    if (!focused) {
      prefix.push(...rules.map(rule => message('developer', rule)));
      if (stage) prefix.push(message('developer', stage));
    }
    return [...prefix, { ...first, content: JSON.stringify({ ...dynamic,
      ...(focused ? { sourceReading: '按以下 path/hash 使用本请求 source 中的原文及范围；full 为全文，excerpt 为片段。' } : {}),
      sources: focused ? sources.map(({ path, hash, mode, required }: any) => ({ path, hash, mode, required }))
        : sources.map(({ content, ...s }: any) => ({ ...s, contentRef: '本会话中相同 path/hash 的 source、已保存工具提交原文或可精确还原的sourceMaterialization；当前范围仍以本条为准' })) }) }, ...input.slice(1)];
  }
  prefix.push(...rules.map(rule => message('developer', rule)));
  if (stage) prefix.push(message('developer', stage, explicit));
  return [...prefix, ...input];
}
