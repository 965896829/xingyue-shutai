import type { WorkbenchObject, WorkbenchField } from '../shared/workbench';
import type { SourceRef } from '../shared/studio';
import { parseCharacterCards, parseLedger } from './manuscript-view';
import { paths, hash } from './domain';
import { parseWorldModel } from './world-model';

const plain = (text: string) => text.replace(/\*\*|`/g, '').trim();
const fieldId = (label: string, index: number) => `field-${hash(`${label}:${index}`).slice(0, 16)}`;
export const workbenchPaths: [string, WorkbenchObject['kind']][] = [
  [paths.roles, 'character'],
  [paths.relations, 'relation'],
  [paths.timeline, 'timeline'],
  [paths.hooks, 'hook'],
  [paths.items, 'item'],
  [paths.knowledge, 'knowledge'],
  [paths.terms, 'term'],
  [paths.behavior, 'behavior'],
  [paths.world, 'world'],
  [paths.volumes, 'plot'],
  [paths.outline, 'plot']
];

function locate(content: string, source: SourceRef, anchor?: SourceRef) {
  let start = content.indexOf(source.quote),
    end = content.length;
  if (start < 0 || !source.quote) return { ...source };
  if (content.indexOf(source.quote, start + 1) >= 0) {
    const at = anchor?.quote ? content.indexOf(anchor.quote) : -1;
    if (at < 0 || content.indexOf(anchor!.quote, at + 1) >= 0) return { ...source };
    const after = at + anchor!.quote.length;
    const boundary = content.slice(after).search(/^#{1,3}\s/m);
    end = boundary < 0 ? content.length : after + boundary;
    start = content.indexOf(source.quote, after);
    if (
      start < 0 ||
      start >= end ||
      (content.indexOf(source.quote, start + 1) >= 0 && content.indexOf(source.quote, start + 1) < end)
    )
      return { ...source };
  }
  const from = Array.from(content.slice(0, start)).length;
  return { ...source, start: from, end: from + Array.from(source.quote).length };
}

function replacement(content: string, field: WorkbenchField, value: string): string | undefined {
  const quote = field.source.quote;
  const bullet = quote.match(/^(\s*[-*]\s*[^：:]+[：:]\s*)(.+)$/);
  if (bullet && plain(bullet[2]) === field.value) return bullet[1] + value;
  if (!/^\s*\|/.test(quote) || field.source.start === undefined) return;
  const prefix = Array.from(content).slice(0, field.source.start).join('');
  const lines = prefix.split(/\r?\n/).filter((line) => line.trim());
  let header: string | undefined;
  for (let i = lines.length - 1; i > 0; i--) {
    if (!/^\s*\|/.test(lines[i])) break;
    if (/^\s*\|[\s:|-]+\|\s*$/.test(lines[i])) {
      header = lines[i - 1];
      break;
    }
  }
  if (!header) return;
  const labels = header.split(/(?<!\\)\|/).map(plain),
    values = quote.split(/(?<!\\)\|/);
  const at = labels.indexOf(field.label);
  if (
    at < 0 ||
    labels.indexOf(field.label, at + 1) >= 0 ||
    values.length !== labels.length ||
    plain(values[at].replace(/\\\|/g, '|').replace(/<br\s*\/?\s*>/gi, '；')) !== field.value
  )
    return;
  values[at] = ` ${value.replaceAll('|', '\\|')} `;
  return values.join('|');
}

export function editWorkbenchField(content: string, field: WorkbenchField, value: string) {
  if (!field.editable || field.source.start === undefined || field.source.end === undefined)
    throw new Error('此字段请通过来源文稿修改');
  if (/[\r\n]/.test(value) || value.length > 4000 || /<!--|wenxu-facts:|^\s*#|```/.test(value))
    throw new Error('字段内容请使用单行正文');
  const points = Array.from(content);
  if (points.slice(field.source.start, field.source.end).join('') !== field.source.quote)
    throw new Error('字段来源已变化');
  const next = replacement(content, field, value);
  if (next === undefined) throw new Error('无法唯一定位字段，请打开来源文稿');
  return points.slice(0, field.source.start).join('') + next + points.slice(field.source.end).join('');
}

export function documentWorkbenchObjects(path: string, content: string): WorkbenchObject[] {
  const entry = workbenchPaths.find(([p]) => p === path);
  if (!entry) return [];
  const doc = { path, content, hash: hash(content), track: 'saved' as const };
  if (entry[1] === 'plot') {
    const sections = content.split(/(?=^#{1,3}\s)/m).filter((v) => v.trim() && !/^#+[^\n]+\s*$/.test(v));
    return sections.map((section, index) => ({
      id: `plot:${hash(`${path}:${section.match(/^#+\s+(.+)/)?.[1] ?? index}`).slice(0, 20)}`,
      title: section.match(/^#+\s+(.+)/)?.[1] ?? path.split('/').at(-1)!,
      kind: 'plot',
      entityIds: [],
      track: 'plan',
      fields: [
        {
          id: 'plan',
          label: '剧情计划',
          value: section.replace(/^#+[^\n]+\n/, '').trim(),
          source: locate(content, { path, hash: doc.hash, quote: section }),
          editable: false,
          locked: false
        }
      ]
    }));
  }
  if (entry[1] === 'world') {
    const model = parseWorldModel(content);
    if (model)
      return model.modules
        .filter((m) => m.state === 'enabled')
        .map((m) => ({
          id: `world:${m.id}`,
          title: m.title,
          kind: 'world',
          entityIds: [],
          track: 'saved',
          fields: [
            {
              id: 'content',
              label: '设定',
              value: m.content,
              source: { path, hash: doc.hash, quote: JSON.stringify(m.content) },
              editable: !m.locked,
              locked: m.locked
            },
            ...Object.entries(m.rule ?? {}).map(([key, value]) => ({
              id: `rule:${key}`,
              label: (
                {
                  scope: '适用范围',
                  trigger: '触发条件',
                  boundary: '能力边界',
                  cost: '代价',
                  exception: '例外',
                  evidence: '已发生证据'
                } as Record<string, string>
              )[key],
              value,
              source: { path, hash: doc.hash, quote: JSON.stringify(value) },
              editable: !m.locked,
              locked: m.locked
            }))
          ]
        }));
    return [
      {
        id: 'world:original',
        title: '世界设定',
        kind: 'world',
        entityIds: [],
        track: 'saved',
        fields: [
          {
            id: 'content',
            label: '设定',
            value: content.split('<!--')[0],
            source: { path, hash: doc.hash, quote: content.split('<!--')[0] },
            editable: false,
            locked: false
          }
        ]
      }
    ];
  }
  const input =
    entry[1] === 'character'
      ? parseCharacterCards(doc).map((c) => ({
          ...c,
          kind: 'character' as const,
          title: c.name,
          entityIds: [c.id]
        }))
      : parseLedger(doc, entry[1] as Parameters<typeof parseLedger>[1]).map((e) => ({
          ...e,
          kind: e.category,
          entityIds: []
        }));
  return input.map((object) => ({
    id: object.id,
    title: object.title,
    kind: object.kind,
    entityIds: object.entityIds,
    track: 'saved',
    ...('from' in object
      ? { from: object.from, to: object.to, chapter: object.chapter, storyTime: object.storyTime }
      : {}),
    fields: object.fields.map((field, index) => {
      const located = locate(content, field.source, object.source);
      const result: WorkbenchField = {
        id: fieldId(field.label, object.fields.slice(0, index).filter((f) => f.label === field.label).length),
        label: field.label,
        value: field.value,
        source: located,
        editable: false,
        locked: false
      };
      result.editable =
        located.start !== undefined &&
        replacement(content, result, field.value) !== undefined &&
        !/^(?:ID|标识|编号|人物编号|人物标识|实体ID)$/i.test(field.label) &&
        !/\bCH\d+\b/.test(field.value);
      return result;
    })
  }));
}
