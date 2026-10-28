import type { FileStore } from './storage';
import type { Fact } from '../shared/types';
import type { SourceRef } from '../shared/studio';
import type { ManuscriptView, ProjectionCharacter, ProjectionEntry, ProjectionField } from '../shared/manuscript-view';
import { paths, hash, memoryPaths } from './domain';
import { compatibleRunBase } from './runtime-settings';
import { visibleFact, sourceValid, conflictingFacts } from './memory-studio';
import { memoryScopeSchema } from '../shared/studio';

interface Document { path: string; hash: string; content: string; track: 'saved' | 'draft' }
const plain = (text: string) => text.replace(/\*\*|`/g, '').trim();
const source = (doc: Document, quote: string): SourceRef => ({ path: doc.path, hash: doc.hash, quote });
const body = (content: string) => content.split(/<!--\s*wenxu-facts:v1\s*-->/)[0].replace(/```[^\n]*\n[\s\S]*?```/g, '');
const stableId = (text: string) => text.match(/\bCH\d+\b/i)?.[0].toUpperCase();
const displayName = (text: string) => plain(text).replace(/^[一二三四五六七八九十\d]+[.、）)]\s*/, '').replace(/\s*[（(][^）)]*[）)]\s*$/, '').trim();
const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(value => plain(value.replace(/\\\|/g, '|').replace(/<br\s*\/?\s*>/gi, '；')));
const field = (doc: Document, label: string, value: string, quote: string): ProjectionField => ({ label, value, source: source(doc, quote), track: doc.track });

export function parseCharacterCards(doc: Document): ProjectionCharacter[] {
  const result: ProjectionCharacter[] = [];
  let current: ProjectionCharacter | undefined;
  for (const line of body(doc.content).split(/\r?\n/)) {
    const heading = line.match(/^#{2,3}\s+(.+)/);
    if (heading) {
      const name = displayName(heading[1]);
      current = /事实记录|说明|模板|当前人物状态|角色卡|人物档案|主要人物|配角|角色列表/.test(name) ? undefined :
        { id: `card-${hash(name).slice(0, 16)}`, name, aliases: [], fields: [], source: source(doc, line), track: doc.track };
      if (current) result.push(current);
      continue;
    }
    const item = plain(line).match(/^[-*]\s*([^：:]{1,40})[：:]\s*(.+)/);
    if (!current || !item) continue;
    current.fields.push(field(doc, item[1], item[2], line));
    const id = /标识|编号|ID|重要度/i.test(item[1] + item[2]) && stableId(item[2]);
    if (id) current.id = id;
    if (/别名|称谓|本名|重要度/.test(item[1])) {
      const names = [...item[2].matchAll(/[“「]([^”」]{1,16})[”」]/g)].map(match => match[1]);
      if (/别名/.test(item[1])) names.push(...item[2].split(/[、,，；;]/));
      current.aliases = [...new Set([...current.aliases, ...names.filter(name => name !== current!.name && !/无|暂无/.test(name))])];
    }
  }
  return result.filter(character => character.fields.length > 0);
}

const categoryFiles: [string, ProjectionEntry['category']][] = [[paths.relations, 'relation'], [paths.timeline, 'timeline'], [paths.hooks, 'hook'],
  [paths.items, 'item'], [paths.knowledge, 'knowledge'], [paths.terms, 'term'], [paths.behavior, 'behavior']];
export function parseLedger(doc: Document, category: ProjectionEntry['category']): ProjectionEntry[] {
  if (category === 'behavior') {
    const sections = body(doc.content).split(/(?=^##\s+第\s*\d+\s*章)/m);
    return sections.flatMap(section => {
      const chapter = section.match(/^##\s+(第\s*\d+\s*章)/m)?.[1];
      return parseCharacterCards({ ...doc, content: section }).map(character => ({ id: `behavior-${hash(`${doc.path}:${chapter ?? ''}:${character.name}`).slice(0, 16)}`,
        category, title: character.name, chapter, fields: character.fields, source: character.source, track: doc.track }));
    });
  }
  const result: ProjectionEntry[] = [];
  let headers: string[] = [], section = '', previous = '';
  for (const line of body(doc.content).split(/\r?\n/)) {
    if (/^#{1,4}\s/.test(line)) section = plain(line.replace(/^#+\s*/, ''));
    if (!/^\s*\|/.test(line)) {
      if (category === 'item' && /^伤势/.test(section) && line.trim() && !/^#/.test(line)) result.push({
        id: `injury-note-${hash(line).slice(0, 16)}`, category: 'injury', title: '伤势记录说明', kind: 'record_note', track: doc.track,
        source: source(doc, line), fields: [field(doc, '原文记录', plain(line), line)]
      });
      headers = []; previous = ''; continue;
    }
    const values = cells(line);
    if (values.every(value => /^:?-+:?$/.test(value))) { headers = cells(previous); continue; }
    if (!headers.length) { previous = line; continue; }
    if (values.length !== headers.length || values.every(value => !value || /^(?:暂无|无|待补充|待填写)$/.test(value))) continue;
    const fields = headers.map((label, index) => field(doc, label, values[index], line)).filter(value => value.value);
    const value = (pattern: RegExp) => fields.find(field => pattern.test(field.label))?.value;
    const kind = category === 'item' && /伤势|受伤/.test(section) ? 'injury' : category;
    result.push({ id: `${kind}-${hash(`${doc.path}:${section}:${values.slice(0, category === 'relation' ? 2 : 1).join('|')}`).slice(0, 16)}`,
      category: kind, title: category === 'relation' ? `${values[0]} → ${values[1]}` : values[0], fields, source: source(doc, line), track: doc.track,
      ...(category === 'relation' ? { from: values[0], to: values[1] } : {}),
      chapter: value(/^(?:章节|来源章节|出现章节|最近更新|首次埋设|生效章节)$/), storyTime: value(/时间锚点|故事时间|发生时间|^时间$/) });
  }
  const counts = new Map<string, number>(), occurrences = new Map<string, number>();
  for (const entry of result) counts.set(entry.id, (counts.get(entry.id) ?? 0) + 1);
  return result.map(entry => {
    if (counts.get(entry.id) === 1) return entry;
    const occurrence = (occurrences.get(entry.id) ?? 0) + 1; occurrences.set(entry.id, occurrence);
    return { ...entry, id: `${entry.id}-occ${occurrence}` };
  });
}

function mergeFields(old: ProjectionField[], next: ProjectionField[]) {
  return next.map(value => { const previous = old.find(field => field.label === value.label);
    return { ...value, ...(previous && previous.value !== value.value ? { previous: previous.value } : {}) }; });
}
function factEntry(fact: Fact, track: 'saved' | 'draft'): ProjectionEntry {
  const evidence = fact.evidence[0];
  return { id: `fact-${fact.id}`, category: fact.category === 'character' ? 'fact' : fact.category, title: fact.subject,
    track, source: evidence, chapter: `第 ${fact.fromChapter} 章`, storyTime: fact.storyTime || '未注明', kind: fact.kind,
    fields: [{ label: fact.predicate, value: fact.value, track, source: evidence }] };
}

/** Read-only author-facing projection. Markdown remains authoritative; this never registers new facts. */
export function readManuscriptView(store: FileStore, chapter: number, runId?: string, includeDraft = true): ManuscriptView {
  const project = store.db.project(), run = runId ? store.db.runs().find(run => run.id === runId && run.chapter === chapter) : undefined;
  const candidate = run && run.projectId === project.id && !run.accepted && !['discarded', 'stale'].includes(run.status) && compatibleRunBase(store, run) ? run : undefined;
  const view: ManuscriptView = { projectId: project.id, revision: project.revision, chapter, runId: candidate?.id, draftAvailable: !!candidate?.changes.length,
    characters: [], entries: [], unavailable: [] };
  const saved = new Map<string, Document>(), drafts = new Map<string, Document>();
  for (const path of memoryPaths) {
    if (project.stale.includes(path)) { view.unavailable.push(path); continue; }
    try { const doc = store.readAccepted(path); saved.set(path, { ...doc, path, track: 'saved' }); }
    catch { view.unavailable.push(path); }
  }
  if (includeDraft && candidate) for (const change of candidate.changes) {
    if (memoryPaths.some(path => path === change.path)) drafts.set(change.path, { path: change.path, content: change.content, hash: hash(change.content), track: 'draft' });
  }
  const characters = new Map<string, ProjectionCharacter>();
  const draftCharacters = drafts.get(paths.roles) ? parseCharacterCards(drafts.get(paths.roles)!) : undefined;
  for (const doc of [saved.get(paths.roles), drafts.get(paths.roles)]) if (doc) for (const character of parseCharacterCards(doc)) {
    const old = [...characters.values()].find(old => old.id === character.id || old.name === character.name);
    if (old) characters.delete(old.id);
    characters.set(character.id, { ...character, fields: old ? mergeFields(old.fields, character.fields) : character.fields });
  }
  view.characters = [...characters.values()].filter(character => !draftCharacters || draftCharacters.some(next => next.id === character.id || next.name === character.name));
  for (const [path, category] of categoryFiles) {
    const old = saved.get(path), next = drafts.get(path), baseline = old ? parseLedger(old, category) : [];
    if (!next) { view.entries.push(...baseline); continue; }
    view.entries.push(...parseLedger(next, category).map(entry => { const previous = /-occ\d+$/.test(entry.id) ? undefined : baseline.find(old => old.id === entry.id);
      return { ...entry, fields: previous ? mergeFields(previous.fields, entry.fields) : entry.fields }; }));
  }
  const snapshot = store.db.head();
  if (snapshot) {
    const scope = memoryScopeSchema.parse({ chapter }), all = store.db.facts(), conflicts = conflictingFacts(all.filter(fact => visibleFact(fact, scope)));
    const accepted = all.filter(fact => visibleFact(fact, scope) && !conflicts.has(fact.id) && fact.evidence.length && fact.evidence.every(e => sourceValid(store, e, snapshot.documents, chapter, project)));
    const pending = includeDraft && candidate ? candidate.facts.filter(fact => !['retracted', 'disputed'].includes(fact.reviewStatus) && !['superseded', 'disputed'].includes(fact.state) && fact.worldId === 'main' && fact.timelineId === 'main' && fact.fromChapter <= chapter && (fact.toChapter === null || fact.toChapter >= chapter) && fact.evidence.length &&
      fact.evidence.every(e => { const change = candidate.changes.find(change => change.path === e.path && hash(change.content) === e.hash);
        return change ? !!e.quote && (e.start !== undefined && e.end !== undefined ? Array.from(change.content).slice(e.start, e.end).join('') === e.quote : change.content.includes(e.quote)) : sourceValid(store, e, snapshot.documents, chapter, project); })) : [];
    const ids = new Set(pending.flatMap(fact => [fact.id, ...(fact.supersedes ? [fact.supersedes] : [])]));
    for (const [facts, track] of [[accepted.filter(fact => !ids.has(fact.id)), 'saved'], [pending, 'draft']] as const) for (const fact of facts) {
      view.entries.push(factEntry(fact, track));
      if (fact.category === 'character' && !view.characters.some(character => character.name === fact.subject || fact.entityIds.includes(character.id)))
        view.characters.push({ id: fact.entityIds[0] || `fact-${fact.id}`, name: fact.subject, aliases: fact.aliases, source: fact.evidence[0], track, fields: [] });
    }
  }
  for (const character of view.characters) for (const value of character.fields.filter(value => /当前目标|后续可用冲突|承诺/.test(value.label))) {
    view.entries.push({ id: `goal-${character.id}-${value.label}`, category: 'promise', title: character.name, kind: 'plan', source: value.source, track: value.track, fields: [value] });
  }
  return view;
}
