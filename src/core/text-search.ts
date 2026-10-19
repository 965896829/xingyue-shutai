const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });

export function indexTerms(text: string) {
  const normalized = text.toLowerCase(), terms = new Set<string>();
  for (const word of segmenter.segment(normalized)) if (word.isWordLike) terms.add(word.segment);
  for (const match of normalized.matchAll(/[\p{Script=Han}]+/gu)) {
    let previous = '';
    for (const char of match[0]) { terms.add(char); if (previous) terms.add(previous + char); previous = char; }
  }
  return [...terms];
}

export function queryTerms(query: string) {
  const matches = query.toLowerCase().match(/[\p{Script=Han}]+|[a-z0-9_-]+/gu) ?? [];
  return [...new Set([
    ...Array.from(segmenter.segment(query.toLowerCase())).filter(s => s.isWordLike).map(s => s.segment),
    ...matches.flatMap(s => {
      const p = Array.from(s);
      return p.length > 2 && /\p{Script=Han}/u.test(s) ? [s, ...p.slice(0, -1).map((x, i) => x + p[i + 1])] : [s];
    })
  ])].slice(0, 100);
}
