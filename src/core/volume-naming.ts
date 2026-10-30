import type { Change, Issue, Run } from '../shared/types';
import type { VolumeNaming } from '../shared/volume-style';
import { hash, paths } from './domain';

export function requestsVolumeNamesOnly(instruction: string) {
  if (/(?:不只|不仅|不是只|并非只).{0,12}(?:卷名|分卷)/.test(instruction)) return false;
  return /(?:只|仅)(?:需要|需)?(?:修改|改|调整|更换|优化|重新生成|重新取|重起)?(?:这些|全部|所有|各个)?(?:卷名|分卷(?:的)?(?:名字|名称|标题))/.test(instruction);
}

const memoryHash = (run?: Pick<Run, 'facts' | 'factRetractions'>) => hash(JSON.stringify({ facts: run?.facts ?? [], retractions: run?.factRetractions ?? [] }));

export function revisedVolumeNaming(previous: VolumeNaming | undefined, instruction: string, content?: string, run?: Pick<Run, 'facts' | 'factRetractions'>): VolumeNaming {
  return {
    version: 2, authorRevision: true,
    ...(previous?.research ? { research: structuredClone(previous.research) } : {}),
    ...(requestsVolumeNamesOnly(instruction) && content && volumeNameSlots(content).slots.some(slot => slot.kind === 'table') ? { renameOnly: { content, hash: hash(content), memoryHash: memoryHash(run) } } : {})
  };
}

function ordinal(value: string) {
  const raw = value.trim().replace(/^第/, '').replace(/卷$/, '');
  if (/^\d+$/.test(raw)) return Number(raw);
  if (!/^[一二三四五六七八九十百零〇两]+$/.test(raw)) return null;
  const digits: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 零: 0, 〇: 0 };
  let total = 0, digit = 0;
  for (const char of raw) {
    if (char === '十' || char === '百') { total += (digit || 1) * (char === '十' ? 10 : 100); digit = 0; }
    else digit = digits[char];
  }
  return total + digit;
}

/** Only template title slots are editable; all other bytes form the frozen skeleton. */
export function volumeNameSlots(content: string) {
  const slots: { start: number; end: number; name: string; order: number; kind: 'table' | 'heading' }[] = [];
  let fence = '', nameColumn = -1, orderColumn = -1;
  for (const line of content.matchAll(/[^\r\n]+/g)) {
    const text = line[0], marker = text.trim().match(/^(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = ''; continue; }
    if (fence) continue;
    const cells = [...text.matchAll(/\|([^|]*)/g)].filter(cell => cell.index! + cell[0].length < text.trimEnd().length);
    const labels = cells.map(cell => cell[1].trim());
    if (labels.includes('卷名') && (labels.includes('卷数') || labels.includes('卷序'))) {
      nameColumn = labels.indexOf('卷名'); orderColumn = Math.max(labels.indexOf('卷数'), labels.indexOf('卷序'));
    } else if (nameColumn >= 0 && cells[nameColumn] && cells[orderColumn]) {
      const order = ordinal(cells[orderColumn][1]);
      if (order !== null) {
        const cell = cells[nameColumn], name = cell[1].trim();
        const start = line.index! + cell.index! + 1 + cell[1].search(/\S|$/);
        slots.push({ start, end: start + name.length, name, order, kind: 'table' });
      }
    }
    if (!text.trimStart().startsWith('|')) { nameColumn = -1; orderColumn = -1; }
    const heading = text.match(/^( {0,3}##\s+第([一二三四五六七八九十百零〇两\d]+)卷\s*[：:]\s*)(.*?)(\s*)$/);
    if (heading) {
      const start = line.index! + heading[1].length;
      slots.push({ start, end: start + heading[3].length, name: heading[3], order: ordinal(heading[2])!, kind: 'heading' });
    }
  }
  let skeleton = content;
  for (const slot of [...slots].sort((a, b) => b.start - a.start)) skeleton = skeleton.slice(0, slot.start) + `\u0000${slot.kind}:${slot.order}\u0000` + skeleton.slice(slot.end);
  return { slots, skeleton };
}

export function volumeRenameIssues(run: Run, changes: Change[] = run.changes): Issue[] {
  const frozen = run.volumeNaming?.renameOnly;
  if (!frozen) return [];
  const fail = (message: string): Issue[] => [{ code: 'volume_rename_scope', severity: 'error', path: paths.volumes, message }];
  if (hash(frozen.content) !== frozen.hash) return fail('卷名修改依据已改变，请重新发起修改');
  if (memoryHash(run) !== frozen.memoryHash) return fail('本次只修改卷名，不能增删或改写故事记忆');
  if (changes.some(change => change.path !== paths.volumes)) return fail('本次只修改卷名，不能同时修改其他文稿');
  const original = volumeNameSlots(frozen.content);
  const tables = original.slots.filter(slot => slot.kind === 'table');
  const headings = original.slots.filter(slot => slot.kind === 'heading');
  if (!tables.length || tables.length !== headings.length || new Set(tables.map(slot => slot.order)).size !== tables.length || tables.some(slot => headings.filter(heading => heading.order === slot.order).length !== 1))
    return fail('原大纲的容量表与分卷标题不能一一对应，请先核对原大纲');
  for (const change of changes) {
    const next = volumeNameSlots(change.content);
    if (next.skeleton !== original.skeleton) return fail('本次只修改卷名，请保留原剧情、章节范围、容量与其他文字');
    for (const slot of next.slots.filter(value => value.kind === 'table')) {
      if (!slot.name || next.slots.find(value => value.kind === 'heading' && value.order === slot.order)?.name !== slot.name)
        return fail('容量表卷名与对应分卷标题需填写相同的名称');
    }
  }
  return [];
}
