import { marked } from 'marked';
export interface MarkdownBlock { signature: string; html: string }
/** Re-lex for Markdown correctness, but parse/sanitize/replace only changed blocks. */
export function markdownBlocks(content: string, previous: MarkdownBlock[] = []): MarkdownBlock[] {
  const tokens = marked.lexer(content);
  // Raw HTML can open a container across block boundaries. Keep its original parse.
  if (tokens.some(token => token.type === 'html')) {
    return [previous[0]?.signature === content ? previous[0] : { signature: content, html: marked.parse(content, { async: false }) }];
  }
  const links = JSON.stringify(tokens.links);
  return tokens.filter(token => token.type !== 'space' && token.type !== 'def').map((token, i) => {
    const signature = token.raw + '\0' + links;
    return previous[i]?.signature === signature ? previous[i] : { signature, html: marked.parser([token], { async: false }) };
  });
}
