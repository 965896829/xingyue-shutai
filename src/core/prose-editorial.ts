import { hash } from './domain';

export const editorialVersion = 'prose-editorial-1';
export interface ProseSource { path: string; content: string; hash: string }
export interface EditorialExcerpt { path: string; hash: string; quote: string; start: number; end: number }
export interface EditorialFinding {
  code: 'repeated_paragraph' | 'recent_prose_overlap' | 'repeated_ending' | 'clustered_transitions' | 'clustered_explanations' | 'assistant_preamble';
  aspect: '开头有效性' | '人物一致性' | '信息落地' | '章末牵引';
  evidence: EditorialExcerpt[];
  reason: string;
}
export interface EditorialReport {
  version: typeof editorialVersion;
  proseHash: string;
  compared: { path: string; hash: string }[];
  findings: EditorialFinding[];
}

// UTF-16 offsets deliberately match the editor and String.slice. These are
// textual signals, never a probability of AI authorship or publication gate.
function lines(source: ProseSource) {
  const result: (EditorialExcerpt & { key: string; narrative: boolean })[] = [];
  let offset = 0, fence = '';
  for (const line of source.content.split(/(?<=\n)/)) {
    const quote = line.trim(), start = offset + line.indexOf(quote);
    offset += line.length;
    const boundary = quote.match(/^(`{3,}|~{3,})/);
    if (boundary) {
      if (!fence) fence = boundary[1];
      else if (boundary[1][0] === fence[0] && boundary[1].length >= fence.length) fence = '';
      continue;
    }
    if (fence || !quote || /^(?:#{1,6}\s|<!--|\|)/.test(quote)) continue;
    result.push({ path: source.path, hash: source.hash, quote, start, end: start + quote.length,
      key: quote.replace(/\s/gu, ''), narrative: !/^[“「『"]/.test(quote) });
  }
  return result;
}

function excerpt(value: EditorialExcerpt): EditorialExcerpt {
  const quote = Array.from(value.quote).slice(0, 160).join('');
  return { path: value.path, hash: value.hash, quote, start: value.start, end: value.start + quote.length };
}

export function inspectProse(prose: ProseSource, recent: ProseSource[] = []): EditorialReport {
  // Reject mismatched provenance rather than inventing evidence for a new draft.
  // FileStore decodes legacy UTF-8 documents without the leading byte-order
  // mark, while their version hash still covers the original bytes.
  const versionMatches = (doc: ProseSource) => doc.hash === hash(doc.content) || doc.hash === hash('\uFEFF' + doc.content);
  if (!versionMatches(prose) || recent.some(doc => !versionMatches(doc))) throw new Error('正文诊断的来源版本不一致');
  const current = lines(prose), history = recent.map(doc => ({ doc, lines: lines(doc) }));
  const findings: EditorialFinding[] = [];
  const seen = new Map<string, typeof current[number]>();
  for (const line of current.filter(line => line.narrative && Array.from(line.key).length >= 40)) {
    const prior = seen.get(line.key);
    if (prior && findings.filter(item => item.code === 'repeated_paragraph').length < 2)
      findings.push({ code: 'repeated_paragraph', aspect: '信息落地', evidence: [excerpt(prior), excerpt(line)],
        reason: '本章出现整段相同叙述。请区分有意复现、回忆与生成重复；只在确实无新增作用时修订。' });
    seen.set(line.key, line);
  }
  const old = new Map(history.flatMap(item => item.lines.filter(line => line.narrative && Array.from(line.key).length >= 40).map(line => [line.key, line] as const)));
  for (const line of current.filter(line => line.narrative)) {
    const match = old.get(line.key);
    if (match && findings.filter(item => item.code === 'recent_prose_overlap').length < 2)
      findings.push({ code: 'recent_prose_overlap', aspect: '信息落地', evidence: [excerpt(line), excerpt(match)],
        reason: '此段与近期已确认正文完全相同。核对是否必要回顾或有意照应，不能仅为避重复而换同义词。' });
  }
  const ending = current.at(-1);
  if (ending?.narrative && Array.from(ending.key).length >= 12 && Array.from(ending.key).length < 40) {
    const matching = history.map(item => item.lines.at(-1)).filter(line => line?.narrative && line.key === ending.key);
    if (matching.length >= 2) findings.push({ code: 'repeated_ending', aspect: '章末牵引',
      evidence: [excerpt(ending), ...matching.slice(-2).map(line => excerpt(line!))],
      reason: '至少三章以同一句叙述收尾。判断是作品固定格式、有效照应，还是没有具体后果的重复预告。' });
  }
  const narrative = current.filter(line => line.narrative && Array.from(line.key).length >= 12);
  for (const [code, markers] of [
    ['clustered_transitions', ['然而', '与此同时', '就在这时', '下一刻', '紧接着']],
    ['clustered_explanations', ['这意味着', '也就是说', '换句话说']]
  ] as const) {
    for (const marker of markers) {
      const matches = narrative.filter(line => line.quote.startsWith(marker));
      if (matches.length >= 3 && matches.length / narrative.length >= .25) {
        findings.push({ code, aspect: '信息落地', evidence: matches.slice(0, 3).map(excerpt),
          reason: `本章多个叙述段以“${marker}”起句，至少占可比较叙述段的四分之一。此词本身正常；仅在造成同质节奏或重复解释时处理，保留必要因果说明。` });
        break;
      }
    }
  }
  const first = current[0];
  if (first && /^(?:以下(?:是|为)(?:按(?:照)?.{0,30})?(?:生成|创作|撰写|修改|润色)(?:的|后)?(?:正文|章节)|好的[，,。！!].{0,20}(?:下面|以下)(?:是|为).{0,20}(?:正文|章节)|作为(?:一个|一名)?(?:AI|人工智能)(?:助手|语言模型))/.test(first.quote))
    findings.unshift({ code: 'assistant_preamble', aspect: '开头有效性', evidence: [excerpt(first)],
      reason: '开头疑似混入助手对用户的说明。结合题材判断是否属于故事内文本；若在故事之外，直接移除说明，保留正文。' });
  return { version: editorialVersion, proseHash: prose.hash, compared: recent.map(({ path, hash }) => ({ path, hash })), findings: findings.slice(0, 8) };
}

export function editorialReviewInput(report: EditorialReport) {
  return { version: report.version, proseHash: report.proseHash,
    policy: '以下是本地文本线索，不是判错、AI检测分数或新增验收维度。依据完整正文、人物卡、作者文风与本章用途，在既有五项审稿中判断；有意复沓、口头禅、回忆、规则解释可以保留。没有命中不代表质量合格。不要为处理提示而新增请求或重复整章审稿。',
    findings: report.findings };
}
