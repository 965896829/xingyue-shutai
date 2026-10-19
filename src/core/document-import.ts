import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';

const hash = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');

function readImportSource(file: string) {
  const fd = fs.openSync(file, 'r');
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) throw new Error('请选择普通文档文件');
    if (stat.size > 30_000_000) throw new Error('单次导入限制为 30 MB');
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const chunk = Buffer.allocUnsafe(Math.min(65536, 30_000_001 - total));
      const count = fs.readSync(fd, chunk, 0, chunk.length, null);
      if (!count) return Buffer.concat(chunks, total);
      total += count;
      if (total > 30_000_000) throw new Error('单次导入限制为 30 MB');
      chunks.push(chunk.subarray(0, count));
    }
  } finally { fs.closeSync(fd); }
}

export function importDocument(file: string) {
  const raw = readImportSource(file);
  const ext = path.extname(file).toLowerCase(),
    warnings: string[] = [];
  let content = '';
  if (ext === '.md' || ext === '.txt') {
    try {
      content = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    } catch {
      content = new TextDecoder('gb18030', { fatal: true }).decode(raw);
      warnings.push('检测到非 UTF-8，已按 GB18030 解码，请核对生僻字。');
    }
    if (content.includes('\uFFFD')) warnings.push('存在无法解码的字符，请检查原文件编码。');
  } else if (ext === '.docx') {
    let total = 0,
      count = 0;
    const entries = unzipSync(raw, {
      filter: (entry) => {
        count++;
        total += entry.originalSize;
        if (total > 80_000_000 || count > 3000) throw new Error('DOCX 解压内容过大');
        return ['word/document.xml', 'word/comments.xml', 'word/footnotes.xml', 'word/endnotes.xml'].includes(
          entry.name
        );
      }
    });
    if (!entries['word/document.xml']) throw new Error('DOCX 缺少正文');
    const xml = new TextDecoder().decode(entries['word/document.xml']);
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('不支持含外部实体声明的文档');
    if (
      /<w:(?:ins|del|commentRangeStart|drawing|pict|fldChar|hyperlink)\b/.test(xml) ||
      Object.keys(entries).length > 1
    )
      warnings.push(
        '文档含修订、批注、图片、域或复杂排版；首版仅导入可见正文及基础段落、标题、列表、表格，请先核对预览。'
      );
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    const nodes = (n: any) => Array.from(n.childNodes ?? []) as any[];
    const text = (n: any): string =>
      n.nodeName === 'w:t'
        ? (n.textContent ?? '')
        : n.nodeName === 'w:tab'
          ? '\t'
          : n.nodeName === 'w:br'
            ? '\n'
            : n.nodeName === 'w:del'
              ? ''
              : nodes(n).map(text).join('');
    const paragraph = (n: any) => {
      const style = n.getElementsByTagName('w:pStyle')[0]?.getAttribute('w:val') ?? '',
        level = style.match(/(?:Heading|标题)([1-6])/i)?.[1];
      return (
        (level ? '#'.repeat(Number(level)) + ' ' : n.getElementsByTagName('w:numPr').length ? '- ' : '') +
        text(n)
      );
    };
    const body = document.getElementsByTagName('w:body')[0];
    if (!body) throw new Error('DOCX 正文结构无效');
    content = nodes(body)
      .map((n) =>
        n.nodeName === 'w:p'
          ? paragraph(n)
          : n.nodeName === 'w:tbl'
            ? nodes(n)
                .filter((r) => r.nodeName === 'w:tr')
                .map((row, i) => {
                  const cells = nodes(row)
                    .filter((c) => c.nodeName === 'w:tc')
                    .map((c) => text(c).replaceAll('|', '\\|').replaceAll('\n', '<br>'));
                  return (
                    `| ${cells.join(' | ')} |` +
                    (i === 0 ? `\n| ${cells.map(() => '---').join(' | ')} |` : '')
                  );
                })
                .join('\n')
            : ''
      )
      .filter(Boolean)
      .join('\n\n');
  } else throw new Error('支持 Markdown、TXT 和 DOCX');
  return { content, warnings, name: path.basename(file, ext), hash: hash(raw) };
}
export type ImportedDocument = ReturnType<typeof importDocument>;
