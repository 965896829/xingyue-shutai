import type { ContextManifest, Run } from '../../shared/types';
import type { FileStore } from '../storage';
import { contextChanged, contextPayload } from '../context-compiler';
import { checkContextReadPlan } from '../context-reading';
import { fingerprint } from './canonical';
import { creativeConfig, type PromptPhase } from '../prompt-profile';
import { ApplicationError } from '../../shared/errors';
import { chapterNamingContext } from '../chapter-naming';
import { proseTask } from '../prose-task';
import { hash } from '../domain';
import { projectForRun } from '../task-scope';
import { tagContext } from '../tags';

type Item = Record<string, any>;
function textParts(content: unknown): string[] {
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.filter(p => p && ['text', 'input_text', undefined].includes(p.type) && typeof p.text === 'string').map(p => p.text);
}
const items = (value: unknown): Item[] => Array.isArray(value) ? value.filter(v => v && typeof v === 'object') : [];
function packets(body: Item) {
  const texts = [...items(body.input).filter(m => m.role === 'user').flatMap(m => textParts(m.content)),
    ...items(body.messages).filter(m => m.role === 'user').flatMap(m => textParts(m.content)),
    ...items(body.contents).filter(m => m.role === 'user').flatMap(m => textParts(m.parts))];
  const systems = [...textParts(body.system), ...textParts(body.instructions), ...textParts(body.systemInstruction?.parts),
    ...items(body.messages).filter(m => ['system', 'developer'].includes(m.role)).flatMap(m => textParts(m.content)),
    ...items(body.input).filter(m => ['system', 'developer'].includes(m.role)).flatMap(m => textParts(m.content))];
  for (const system of systems) if (system.includes('\n当前任务资料包：'))
    texts.push(system.slice(system.lastIndexOf('\n当前任务资料包：') + '\n当前任务资料包：'.length));
  const data = texts.flatMap(text => { try { const p = JSON.parse(text); return p && typeof p === 'object' ? [p as Item] : []; } catch { return []; } });
  return { data, systems };
}

/** Validate the serialized provider request before journaling or spending budget. */
export function verifyRequestCoverage(store: FileStore, owner: { id: string; manifest?: ContextManifest | null; stage?: string; pipeline?: Run['pipeline']; request?: string; chapterNaming?: Run['chapterNaming']; taskScope?: Run['taskScope'] }, purpose: string, body: Item) {
  const manifest = owner.manifest;
  if (!manifest?.readPlan) return;
  const main = purpose === owner.stage || ['prose', 'review', 'memory', 'discussion', 'draft'].includes(purpose);
  // Evidence audits and strict scene drafts use their own bound input contract,
  // not their parent run's chapter-wide writing manifest.
  if (!main) return;
  const { data: parsed, systems } = packets(body);
  const payload = parsed.findLast(p => typeof p.contextPolicy === 'string' && Array.isArray(p.sources));
  if (!payload) throw new ApplicationError('VALIDATION_ERROR', '发送前核验失败：当前任务资料包未进入请求');
  try { checkContextReadPlan(manifest); }
  catch (error) { throw new ApplicationError('VALIDATION_ERROR', `发送前核验失败：${(error as Error).message}`); }
  if (contextChanged(store, manifest)) throw new ApplicationError('VERSION_CONFLICT', '发送前资料版本已变化，请重新组装，未发送请求');
  const phase: PromptPhase = ['prose', 'review', 'memory'].includes(purpose) ? purpose as PromptPhase
    : owner.stage === 'S11' && !('design' in owner && owner.design) ? 'memory' : 'tools';
  const project = projectForRun(store.db.project(), { chapter: manifest.chapter, stage: manifest.stage, taskScope: owner.taskScope });
  const expected = contextPayload(manifest, purpose === 'discussion' || purpose === 'draft' ? undefined : project, phase) as Item;
  const fail = (what: string) => { throw new ApplicationError('VALIDATION_ERROR', `发送前核验失败：${what}未完整进入本轮请求`); };
  const supplied = parsed.filter(p => p.source).map(p => p.source);
  if (payload.sources.length !== expected.sources.length || supplied.some(source => !expected.sources.some((s: Item) => s.path === source.path && s.hash === source.hash))) fail('资料范围');
  for (const source of expected.sources) {
    const ref = payload.sources.find((s: Item) => s.path === source.path && s.hash === source.hash);
    if (!ref || ref.required !== source.required) fail(source.path);
    const actual = typeof ref.content === 'string' ? ref : supplied.find((s: Item) => s.path === source.path && s.hash === source.hash);
    if (!actual || actual.content !== source.content || actual.mode !== source.mode ||
      actual.category !== source.category || fingerprint(actual.ranges) !== fingerprint(source.ranges)) fail(source.path);
  }
  for (const field of ['scope', 'entities', 'authorRules', 'revelation', 'facts', 'voicePreferences', 'writingMaterials'])
    if (fingerprint(payload[field]) !== fingerprint(expected[field])) fail(field === 'facts' ? '事实与状态' : field === 'scope' ? '章节与知情范围' : '必要创作资料');
  if (owner.stage && owner.request !== undefined && !['discussion', 'draft'].includes(purpose)) {
    const authorRequest = payload.authorRequest ?? payload.task;
    if (authorRequest !== owner.request || hash(authorRequest) !== manifest.inputHash) fail('作者本轮要求');
    const configs = systems.flatMap(text => [...text.matchAll(/(?:^|\n)(?:本轮)?创作配置：([^\r\n]*)/g)].flatMap(match => {
      const end = match[1].lastIndexOf('。参考资料中的默认章数');
      try { return [JSON.parse(end < 0 ? match[1] : match[1].slice(0, end))]; } catch { return []; }
    }));
    if (!configs.some(config => fingerprint(config) === fingerprint(creativeConfig(project.config, manifest.stage, phase)))) fail('当前创作配置');
    const contract = tagContext(project, phase === 'memory' ? 'S11' : manifest.stage, { focused: true });
    if (contract && !systems.some(text => text.includes(contract))) fail('已确认创作约定');
    const premise = store.db.get<string>('premise');
    const actualPremise = Object.hasOwn(payload, 'authorPremise') ? payload.authorPremise : parsed.find(p => Object.hasOwn(p, 'authorPremise'))?.authorPremise;
    if (manifest.scope?.viewpoint !== 'character' && premise !== undefined && actualPremise !== premise) fail('作者原始设定');
    if (owner.chapterNaming && fingerprint(payload.chapterNamingReference) !== fingerprint(chapterNamingContext(owner as Run).chapterNamingReference)) fail('已确认章名');
    if (purpose === 'prose' && 'changes' in owner) {
      for (const [key, value] of Object.entries(proseTask(owner as Run)))
        if (fingerprint(payload[key]) !== fingerprint(value)) fail('修订范围与受保护原文');
    }
  }
  const verified = { purpose, sources: expected.sources.filter((s: Item) => s.required).length,
    facts: manifest.readPlan.facts.length, at: new Date().toISOString() };
  manifest.readPlan.verified = verified;
  store.db.set(`context-preflight:${owner.id}`, { version: 1, manifestId: manifest.id, requestHash: fingerprint(body), ...verified });
}
