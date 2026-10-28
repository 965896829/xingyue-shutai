import { z } from 'zod';

export const narrativeKinds = ['beat', 'climax', 'reversal', 'emotion', 'payoff', 'hook', 'release'] as const;
export const narrativeKindNames = { beat: '推进', climax: '高潮', reversal: '反转', emotion: '情绪', payoff: '兑现', hook: '悬念', release: '缓和' } as const;
export const narrativeNodeSchema = z.object({
  kind: z.enum(narrativeKinds), label: z.string().trim().min(1).max(32),
  intensity: z.number().int().min(1).max(5), anchor: z.string().trim().min(6).max(120),
  emotion: z.string().trim().min(1).max(32).optional(), valence: z.number().int().min(-2).max(2).optional()
});
export const narrativeEventSchema = narrativeNodeSchema.extend({ id: z.string(), start: z.number().int().nonnegative(), end: z.number().int().positive() });
export const narrativeEventStateSchema = z.object({ version: z.literal(1), epoch: z.string(), events: z.array(narrativeEventSchema).max(32) });
export type NarrativeEvent = z.infer<typeof narrativeEventSchema>;
export type NarrativeEventState = z.infer<typeof narrativeEventStateSchema>;

/** UTF-16 offsets refer to the clean saved manuscript, never to the transport envelope. */
export function visibleNarrativeEvents(events: readonly NarrativeEvent[], text: string): NarrativeEvent[] {
  return events.filter(event => event.end <= text.length && event.end > event.start && text.slice(event.start, event.end) === event.anchor);
}

/** Optional sideband metadata in the SAME prose response. Invalid metadata cannot
 * fail a chapter or trigger a retry. All ordinary manuscript bytes are preserved. */
export class NarrativeDecoder {
  text = '';
  events: NarrativeEvent[] = [];
  ignored = 0;
  private pending = '';
  private discardLine = false;
  private ended = false;
  constructor(private onText: (text: string) => void = () => {}, private onEvent: (event: NarrativeEvent) => void = () => {}) {}
  push(chunk: string) {
    if (this.ended || !chunk) return;
    this.pending += chunk;
    while (this.pending) {
      if (this.discardLine) {
        const newline = this.pending.indexOf('\n');
        if (newline < 0) { this.pending = ''; return; }
        this.pending = this.pending.slice(newline); this.discardLine = false;
      }
      const opening = this.pending.indexOf('<!--');
      if (opening < 0) {
        const tail = ['<!-', '<!', '<'].find(prefix => this.pending.endsWith(prefix))?.length ?? 0;
        this.write(this.pending.slice(0, this.pending.length - tail)); this.pending = this.pending.slice(this.pending.length - tail);
        return;
      }
      if (opening > 0) { this.write(this.pending.slice(0, opening)); this.pending = this.pending.slice(opening); }
      const prefix = this.pending.match(/^<!--[ \t]*/)!;
      const rest = this.pending.slice(prefix[0].length), name = rest.slice(0, 11).toLowerCase();
      if ('wenxu-event'.startsWith(name) && name.length < 11 && prefix[0].length < 16) return;
      if (name !== 'wenxu-event' || /^[\w-]/.test(rest.slice(11, 12))) {
        this.write('<!--'); this.pending = this.pending.slice(4); continue;
      }
      const begin = prefix[0].length + 11, end = this.pending.indexOf('-->', begin);
      // The requested protocol is one line, but harmless JSON formatting must
      // not leak into the manuscript. Stop at a recognizable prose line if a
      // comment was cut off; keep the bounded JSON fragment across chunks.
      const proseLine = [...this.pending.slice(begin).matchAll(/\n([^\n]*)/g)].find(line => {
        const value = line[1].trim();
        return value && !/^(?:["{}\[\],\d.\-]|true\b|false\b|null\b|-->)/.test(value);
      });
      const boundary = proseLine ? begin + proseLine.index! : -1;
      const paragraphBreak = boundary >= 0 ? this.pending.slice(begin, boundary).match(/\n[ \t\r\n]*$/) : null;
      const newline = paragraphBreak ? begin + paragraphBreak.index! : boundary;
      if (end >= 0 && (newline < 0 || end < newline)) {
        const payload = this.pending.slice(begin, end).replace(/^\s*:\s*/, '').trim();
        if (payload.length <= 3072) this.record(payload); else this.ignored++;
        this.pending = this.pending.slice(end + 3); continue;
      }
      if (newline >= 0) { this.ignored++; this.pending = this.pending.slice(newline); continue; }
      if (this.pending.length > 4096) { this.ignored++; this.pending = ''; this.discardLine = true; }
      return;
    }
  }
  finish() {
    if (this.ended) return;
    this.ended = true;
    // An unfinished reserved annotation is metadata, not a manuscript ending.
    const candidate = this.pending.replace(/^<!--[ \t]*/, '').toLowerCase();
    const reserved = this.pending.startsWith('<!--') && (candidate.startsWith('wenxu-event') || candidate.length >= 5 && 'wenxu-event'.startsWith(candidate));
    if (!this.discardLine && !reserved) this.write(this.pending);
    else if (this.pending) this.ignored++;
    this.pending = '';
  }
  private write(text: string) { if (text) { this.text += text; this.onText(text); } }
  private record(payload: string) {
    try {
      const parsed = narrativeNodeSchema.safeParse(JSON.parse(payload));
      if (!parsed.success || this.events.length >= 32) { this.ignored++; return; }
      const node = parsed.data, start = this.text.indexOf(node.anchor), end = start + node.anchor.length;
      if (start < 0 || this.text.indexOf(node.anchor, start + 1) >= 0 || start < (this.events.at(-1)?.end ?? 0)) { this.ignored++; return; }
      const event: NarrativeEvent = { ...node, id: `event:${start}:${end}:${node.kind}`, start, end };
      this.events.push(event); this.onEvent(event);
    } catch { this.ignored++; }
  }
}

export function decodeNarrativeResponse(raw: string) {
  const decoder = new NarrativeDecoder(); decoder.push(raw); decoder.finish(); return decoder;
}

export const narrativeStreamInstruction = `## 正文同步节点（仅传输附带数据）
正文仍按原 Skill 完整写作，人物声音、场面和字数要求不变；不要为凑曲线添加冲突或解释剧情。
在实际写出的场面发生明显变化时，紧接该段末尾附一条单行注释：<!--wenxu-event:{"kind":"reversal","label":"退路被封","intensity":4,"anchor":"复制刚写出的六至一百二十字连续原句","emotion":"犹疑→惊惧","valence":-2}-->，之后正常换段。宿主会立即分离注释，展示和保存的正文不含这些数据。
kind 取 beat推进、climax高潮、reversal反转、emotion情绪转折、payoff回报兑现、hook悬念、release缓和。label 用具体事件短名。intensity 沿用1—5情节强度；valence 为当下读者情绪方向（-2强负向、-1负向、0中性/混合、1正向、2强正向），无法判断就省略 emotion 和 valence。
通常在开篇场面和后续重要节点给出3—10点即可，不按每段打分，不强凑高潮。anchor 必须在此前已输出的正文中唯一出现，按原文先后定位，禁止标记未写事件。JSON 压成单行；不用代码围栏、不另开工具或请求、不解释标记。正文质量优先，缺少节点也不补写或重新生成正文。`;
