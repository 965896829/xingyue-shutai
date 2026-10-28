/** Remove only an explicit opening chapter heading; never infer a title from an ordinary first paragraph. */
export function extractProseBody(text: string): string {
  const source = text.replace(/^\uFEFF/, '');
  const opening = source.replace(/^\s*/u, '');
  const heading = opening.match(/^#(?!#)[^\r\n]*(?:\r?\n|$)/);
  if (heading) return opening.slice(heading[0].length);

  const firstLine = opening.match(/^([^\r\n]*)(?:\r?\n|$)/)!;
  const chapter = firstLine[1].match(/^第[0-9０-９零〇一二三四五六七八九十百千万两]+[章回](?:[\t \u3000]+(.+?))?[\t \u3000]*$/u);
  if (!chapter) return source;
  const title = chapter[1]?.trim() ?? '';
  // A short, separate chapter label is unambiguous. Sentence punctuation or quoted
  // speech after a chapter number is deliberately retained as prose.
  if (Array.from(title).length > 80 || /[。；;，,：“”‘’「」『』"']/u.test(title)) return source;
  return opening.slice(firstLine[0].length);
}
