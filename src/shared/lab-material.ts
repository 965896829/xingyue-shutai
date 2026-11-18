import { chapterSpan } from './chapter-range';
import { labMaterialHeadings, labProseSections, type LabMaterialRule, type LabVersion } from './story-lab';

/** Each body paragraph has an independent audience and time boundary. Headings only locate the text. */
export function labMaterialBlocks(content: string, saved: LabMaterialRule[] = []) {
  const headings = labMaterialHeadings(content), formerlyPublic = new Set(labProseSections(headings));
  const indexed = new Map(saved.map(rule => [rule.offset, rule]));
  const blocks: { rule: LabMaterialRule; label: string; text: string }[] = [];
  const ancestors: typeof headings = [];
  for (const [section, h] of headings.entries()) {
    while (ancestors.length && ancestors.at(-1)!.level >= h.level) ancestors.pop();
    ancestors.push(h);
    const scope = ancestors.map(a => a.title);
    const end = headings[section + 1]?.start ?? content.length;
    const sectionText = content.slice(h.start, end);
    let offset = h.start, hidden = false;
    for (const line of sectionText.split(/(?<=\n)/)) {
      const here = offset; offset += line.length;
      if (!line.trim() || /^#{1,6}\s/.test(line)) continue;
      if (/^\s*(?:[-*>]\s*)?(?:公开|表层|人尽皆知)/.test(line)) hidden = false;
      if (/^\s*(?:[-*>]\s*)?(?:隐藏真相|真相|幕后|剧透|结局|秘密)[：:]/.test(line)) hidden = true;
      const span = chapterSpan(line.match(/^\s*(?:[-*>]\s*)?(第[^：:。\n]{1,20}章)/)?.[1] ?? '') ??
        [...scope].reverse().map(title => chapterSpan(title)).find(Boolean);
      const secret = hidden || scope.some(t => /隐藏真相|结局|远期|幕后|终局|卷末/.test(t) && !/世界核心与隐藏真相/.test(t));
      const mixed = /世界核心与隐藏真相/.test(h.title);
      const publicText = formerlyPublic.has(section) || mixed && !secret || !!span;
      const reveal = line.match(/(?:从|到|于)?(第[零〇一二三四五六七八九十百千\d]+章)(?:才|首次|方可|开始)?(?:揭示|公开|揭晓)/);
      const rule: LabMaterialRule = indexed.get(here) ?? { section, offset: here,
        category: secret ? 'secret' : /文风|对白|声音/.test(h.title) ? 'voice' : /主角|人物/.test(h.title) ? 'character' : span ? 'plan' : 'setting',
        fromChapter: span?.[0] ?? 1, throughChapter: span?.[1],
        revealAt: reveal ? chapterSpan(reveal[1])?.[0] ?? null : secret || !publicText ? null : 1 };
      blocks.push({ rule, label: h.title, text: line });
    }
  }
  return blocks;
}
export function inheritedLabRules(content: string, base?: LabVersion) {
  const previous = new Map<string, LabMaterialRule | null>();
  if (base?.materialRules) for (const b of labMaterialBlocks(base.content, base.materialRules)) {
    const key = b.label + '\n' + b.text;
    previous.set(key, previous.has(key) ? null : b.rule);
  }
  return labMaterialBlocks(content).map(({ rule, label, text }) => {
    const prior = previous.get(label + '\n' + text);
    return prior ? { ...prior, offset: rule.offset, section: rule.section } : rule;
  });
}
export function visibleLabMaterial(rule: LabMaterialRule, chapter: number) {
  return rule.revealAt !== null && rule.revealAt <= chapter && rule.fromChapter <= chapter && (!rule.throughChapter || chapter <= rule.throughChapter);
}
