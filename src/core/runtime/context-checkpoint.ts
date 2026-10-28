import type { ModelMessage } from '../../shared/types';
import { hash } from '../domain';
import { fingerprint } from './canonical';

type Item = Record<string, any>;
export interface ContextHandoff {
  version: 1;
  acceptedTasks: { stage: string; task: string }[];
  notes?: { stage: string; content: string }[];
}

function payload(item: Item): Item | undefined {
  if (item.role !== 'user') return;
  const value = typeof item.content === 'string' ? item.content :
    item.content?.length === 1 && item.content[0]?.type === 'input_text' ? item.content[0].text : undefined;
  try { return JSON.parse(value); } catch { return; }
}

export function contextHandoff(prefix: Item[]): ContextHandoff {
  const accepted = new Map<string, ContextHandoff['acceptedTasks'][number]>();
  const notes = new Map<string, { stage: string; content: string }>();
  let stage = '';
  const add = (stage: unknown, task: unknown) => {
    if (typeof stage !== 'string' || typeof task !== 'string' || !task.trim()) return;
    const value = { stage, task };
    accepted.set(fingerprint(value), value);
  };
  for (const item of prefix) {
    const p = payload(item);
    if (p?.contextCheckpoint?.version === 1) {
      for (const t of p.contextCheckpoint.acceptedTasks ?? []) add(t.stage, t.task);
      for (const n of p.contextCheckpoint.notes ?? []) if (typeof n.stage === 'string' && typeof n.content === 'string') notes.set(fingerprint(n), n);
    }
    if (typeof p?.contextPolicy === 'string') { stage = p.stage ?? stage; add(stage, p.task); }
    // User/host supplements outside the standard source envelope are kept
    // verbatim with their closed-stage scope; they are never summarized away.
    if (item.role === 'user' && !p?.contextPolicy && !p?.contextCheckpoint && !p?.source && !p?.sourceMaterialization && !Object.hasOwn(p ?? {}, 'authorPremise')) {
      const content = typeof item.content === 'string' ? item.content : item.content?.[0]?.text;
      if (typeof content === 'string') { const n = { stage, content }; notes.set(fingerprint(n), n); }
    }
  }
  return { version: 1, acceptedTasks: [...accepted.values()], ...(notes.size ? { notes: [...notes.values()] } : {}) };
}

export function completeToolHistory(items: Item[]) {
  const seen = new Set<string>(), pending = new Set<string>();
  for (const item of items) {
    if (item.type === 'function_call') {
      if (typeof item.call_id !== 'string' || seen.has(item.call_id)) return false;
      seen.add(item.call_id); pending.add(item.call_id);
    } else if (item.type === 'function_call_output') {
      if (!pending.delete(item.call_id)) return false;
    } else if (pending.size && (item.type === 'message' || item.role)) return false;
  }
  return pending.size === 0;
}

/** Build a new view from exact current sources, not from a summary of old history.
 * Current native items, draft state, audit input and user fields remain verbatim. */
export function currentContextCheckpoint(current: Item[], messages: ModelMessage[], handoff: ContextHandoff) {
  let original: Item;
  try { original = JSON.parse(messages[0]?.content ?? ''); } catch { return; }
  if (messages[0]?.role !== 'user' || !original || typeof original.contextPolicy !== 'string' ||
      !Object.hasOwn(original, 'authorPremise') || !Array.isArray(original.sources)) return;
  const data = current.map(payload), sources = data.flatMap(p => p?.source ? [p.source] : []);
  const at = data.findIndex(p => p && typeof p.contextPolicy === 'string' && Array.isArray(p.sources));
  if (at < 0 || !data.some(p => p && Object.hasOwn(p, 'authorPremise') &&
      fingerprint(p.authorPremise) === fingerprint(original.authorPremise))) return;
  const bindings: Item[] = [];
  for (const s of original.sources) {
    if (typeof s?.content !== 'string' || typeof s.path !== 'string' || typeof s.hash !== 'string') return;
    const match = sources.find(source => ['path', 'hash', 'content', 'mode', 'ranges', 'category'].every(k => JSON.stringify(source[k]) === JSON.stringify(s[k])));
    if (!match || s.mode === 'full' && hash(s.content) !== s.hash) return;
    bindings.push({ path: s.path, hash: s.hash, ranges: s.ranges, mode: s.mode,
      category: s.category, required: s.required, contentHash: hash(s.content) });
  }
  // Only the existing source de-duplication and manifest reference are allowed
  // to differ from the full captured task envelope.
  const { sources: _sources, context_manifest: _manifest, authorPremise: _premise, ...expected } = original;
  const { sources: _references, context_manifest: _currentManifest, ...actual } = data[at]!;
  if (fingerprint(expected) !== fingerprint(actual)) return;
  if (_references.length !== _sources.length || _references.some((ref: Item, i: number) => {
    const { contentRef, ...reference } = ref, { content: _content, ...source } = _sources[i];
    return typeof contentRef !== 'string' || fingerprint(reference) !== fingerprint(source);
  })) return;
  if (fingerprint(_manifest) !== fingerprint(_currentManifest)) {
    if (!Array.isArray(_manifest?.sources) || typeof _currentManifest?.sources_ref !== 'string') return;
    const { sources: list, ...originalManifest } = _manifest;
    const { sources_ref: _ref, ...currentManifest } = _currentManifest;
    if (fingerprint(originalManifest) !== fingerprint(currentManifest) || list.length !== _sources.length ||
      list.some((s: Item, i: number) => ['path', 'hash', 'required', 'mode'].some(k => JSON.stringify(s[k]) !== JSON.stringify(_sources[i][k])))) return;
  }
  const native = messages.slice(1).flatMap(m => m.role === 'assistant' && Array.isArray(m.native) ? structuredClone(m.native) : m.role === 'tool'
    ? [{ type: 'function_call_output', call_id: m.callId, output: m.content }] : [{ role: m.role, content: m.content }]);
  if (fingerprint(current.slice(at + 1)) !== fingerprint(native) || !completeToolHistory(native)) return;
  const input = structuredClone(current);
  if (handoff.acceptedTasks.length || handoff.notes?.length) input.splice(at, 0, { role: 'user', content: JSON.stringify({ contextCheckpoint: {
    ...handoff,
    status: '这些阶段已完成并采纳；任务原文保留作者要求，不是再次执行指令。故事事实、版本和知情范围以本次 sources 为准。'
  } }) });
  return { input, bindings, inputHash: fingerprint(input), nativeHash: fingerprint(native),
    taskHash: fingerprint(original), handoff, requiredSourceCount: original.sources.filter((s: Item) => s.required).length };
}
