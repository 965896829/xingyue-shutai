import { readIntensity, chapterIntensity } from './narrative-curve';
export interface NarrativeScene { title: string; action: string; hook: string; content: string; strength?: number }
export interface NarrativePlan { strength?: number; payoff: string; scenes: NarrativeScene[] }
const clean = (value: string) => value.replace(/[*`]/g, '').trim();
export function narrativePlan(content: string): NarrativePlan {
  content = content.replace(/\*\*/g, '');
  const strength = chapterIntensity(content)?.strength;
  const payoff = content.match(/(?:本章主要阅读回报|主要阅读回报)[：:]\s*(.+)/)?.[1] ?? '';
  const scenes: NarrativeScene[] = [];
  for (const line of content.split(/\r?\n/)) {
    const heading = line.match(/^#{2,4}\s*((?:场面|场景)\s*[一二三四五六七八九十\d]+[^\n]*)/);
    if (heading) { scenes.push({ title: clean(heading[1]), action: '', hook: '', content: '' }); continue; }
    const scene = scenes.at(-1);
    if (!scene) continue;
    const field = clean(line.replace(/^\s*[-*]\s*/, ''));
    scene.content += field + '\n';
    const intensity = field.match(/^(?:场面强度|情节强度|强度)[：:]\s*(.*)/);
    if (intensity) scene.strength = readIntensity(intensity[1]) ?? undefined;
    if (/^(?:动作(?:\/对话)?推进|场景任务|主要动作|主角行动|主角主动选择|回报内容|最后一幕|动作与对话)[：:]/.test(field)) scene.action = field.replace(/^[^：:]+[：:]\s*/, '');
    if (/^(?:小钩子|阅读回报|余波\/状态变化|场景落点|下一章必须承接)[：:]/.test(field)) scene.hook = field.replace(/^[^：:]+[：:]\s*/, '');
  }
  return { strength, payoff: clean(payoff), scenes };
}
export function narrativeProgress(text: string, targetWords: number, _sceneCount: number, finished: boolean) {
  const body = text.replace(/^#{1,6}\s+.*$/gm, '').trim();
  const characters = Array.from(body.replace(/\s/g, '')).length;
  const ratio = finished && characters ? 1 : Math.min(0.98, characters / Math.max(1, targetWords));
  return { characters, paragraphs: body ? body.split(/\n\s*\n/).length : 0, ratio,
    scene: -1 }; // Word count is progress only; it cannot identify a scene.
}

/** Old plans have no per-scene scores. Explicitly labelled, conservative local estimates only. */
export function sceneEstimate(scene: NarrativeScene): { value: number | null; reason: string; estimated: boolean } {
  if (scene.strength) return { value: scene.strength, reason: '细纲已标注场面强度', estimated: false };
  const text = `${scene.title}\n${scene.content.replace(/^[^\n：:]{1,35}[：:]\s*/gm, '')}\n${scene.action}\n${scene.hook}`.replace(/(?:不再|没有|不会|避免|禁止|不必|不得|不能|未曾|无需)[^，。；;\n]{0,18}/g, '');
  const rules: [RegExp, number, string][] = [
    [/决战|生死关头|濒死|必死|终局对决|全面爆发/, 5, '场面包含生死对决或关键爆发'],
    [/绝境|围攻|追杀|强攻|崩塌|殊死|激战|逼迫|倒计时|失格后果不可逆|最后.{0,5}(?:机会|退路)/, 4, '场面包含明确的高压冲突或迫近的期限'],
    [/兑现|余波|终于|休整|和解|日常|缓和|清点收获/, 2, '场面主要承接回报、缓和或余波'],
    [/阻碍|风险|代价|抢修|拆下|抉择|选择|异常|中断|故障|陌生|线索|秘密|悬念|调查|核对|复核|检查|施工|签认|检测|通过结算/, 3, '场面包含推进、阻碍或新线索'],
    [/休息|平静|闲聊|入睡/, 1, '场面主要为平静过渡']
  ];
  const rule = rules.find(([pattern]) => pattern.test(text));
  return rule ? { value: rule[1], reason: `${rule[2]}（本地规则预估）`, estimated: true } :
    { value: null, reason: '没有足够线索估计强度', estimated: true };
}

export interface SceneMatch { scene: number; start: number; end: number; quote: string }
const tokens = (text: string) => {
  const set = new Set<string>();
  for (const part of text.replace(/^.*?[：:]/gm, '').match(/[\p{L}\p{N}]+/gu) ?? [])
    for (let size = 4; size <= 8; size++) for (let i = 0; i + size <= part.length; i++) set.add(part.slice(i, i + size));
  return set;
};
/** Incremental paragraph matching. No averaging by word count or model call. */
export class SceneLocator {
  private text = '';
  private consumed = 0;
  private matches: SceneMatch[] = [];
  private terms: string[][];
  constructor(scenes: NarrativeScene[]) {
    const sets = scenes.map(scene => tokens(`${scene.action}\n${scene.hook}\n${scene.content}`));
    this.terms = sets.map((set, index) => [...set].filter(term => !sets.some((other, i) => i !== index && other.has(term)))
      .sort((a, b) => b.length - a.length).slice(0, 300));
  }
  update(text: string, finished = false): SceneMatch[] {
    if (!text.startsWith(this.text)) { this.consumed = 0; this.matches = []; }
    this.text = text;
    const base = this.consumed, tail = text.slice(base);
    for (const match of tail.matchAll(/([^\n]*(?:\n(?!\s*\n)[^\n]*)*)(?:\n\s*\n|$)/g)) {
      if (!match[1]?.trim()) continue;
      const offset = base + match.index!, end = offset + match[0].length;
      if (end === text.length && !finished && !/\n\s*\n$/.test(match[0])) continue;
      const paragraph = match[1].trim();
      if (/^#{1,6}\s/.test(paragraph)) continue;
      const scores = this.terms.map(terms => {
        const found = terms.filter(term => paragraph.includes(term));
        const distinct = found.filter(term => !found.some(long => long.length > term.length && long.includes(term)));
        return distinct.reduce((sum, term) => sum + term.length, 0);
      });
      const ranked = scores.map((score, scene) => ({ score, scene })).sort((a, b) => b.score - a.score);
      const best = ranked[0], second = ranked[1]?.score ?? 0;
      if (best && best.score >= 4 && best.score >= second + 2 && best.scene >= (this.matches.at(-1)?.scene ?? 0) &&
        !this.matches.some(value => value.scene === best.scene)) {
        const start = offset + match[1].indexOf(paragraph);
        this.matches.push({ scene: best.scene, start, end: start + paragraph.length, quote: paragraph });
      }
    }
    const boundary = text.lastIndexOf('\n\n');
    if (finished) this.consumed = text.length;
    else if (boundary >= base) this.consumed = boundary + 2;
    return this.matches;
  }
}
