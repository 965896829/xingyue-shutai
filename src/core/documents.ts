import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';
import { Document, Packer, Paragraph, HeadingLevel, Table, TableRow, TableCell } from 'docx';
import { backup } from 'node:sqlite';
import { FileStore, atomicWrite, safePath, fileHash } from './storage';
import { hash, id, now } from './domain';

export function importDocument(file: string) {
  const raw = fs.readFileSync(file);
  if (raw.length > 30_000_000) throw new Error('单次导入限制为 30 MB');
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
export async function exportDocument(content: string, target: string) {
  const ext = path.extname(target).toLowerCase();
  if (fs.existsSync(target)) throw new Error('目标文件已存在，请选择新文件名以免覆盖');
  if (ext === '.docx') {
    const children: (Paragraph | Table)[] = [],
      lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('|')) {
        const rows = [];
        while (i < lines.length && lines[i].startsWith('|')) {
          const cells = lines[i]
            .split('|')
            .slice(1, -1)
            .map((s) => s.trim());
          if (!cells.every((c) => /^:?-+:?$/.test(c)))
            rows.push(
              new TableRow({ children: cells.map((c) => new TableCell({ children: [new Paragraph(c)] })) })
            );
          i++;
        }
        i--;
        if (rows.length) children.push(new Table({ rows }));
        continue;
      }
      const title = line.match(/^(#{1,6}) (.*)$/);
      children.push(
        new Paragraph(
          title
            ? {
                text: title[2],
                heading: [
                  HeadingLevel.HEADING_1,
                  HeadingLevel.HEADING_2,
                  HeadingLevel.HEADING_3,
                  HeadingLevel.HEADING_4,
                  HeadingLevel.HEADING_5,
                  HeadingLevel.HEADING_6
                ][title[1].length - 1]
              }
            : line.startsWith('- ')
              ? { text: line.slice(2), bullet: { level: 0 } }
              : { text: line }
        )
      );
    }
    atomicWrite(target, await Packer.toBuffer(new Document({ sections: [{ children }] })));
  } else if (ext === '.md' || ext === '.txt')
    atomicWrite(target, ext === '.txt' ? content.replace(/^#{1,6} /gm, '') : content);
  else throw new Error('请选择 .md、.txt 或 .docx 文件名');
  return target;
}
export async function createBackup(store: FileStore, directory: string) {
  const relative = path.relative(store.root, path.resolve(directory));
  if (!relative || (!relative.startsWith('..') && !path.isAbsolute(relative)))
    throw new Error('备份目录必须位于作品目录之外');
  const target = path.join(
    directory,
    `文序备份_${new Date().toISOString().replace(/[:.]/g, '-')}_${id().slice(0, 8)}`
  );
  fs.mkdirSync(target, { recursive: true });
  const manifest: { path: string; hash: string }[] = [];
  function walk(dir: string, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const rel = prefix + entry.name;
      if (/(?:state\.sqlite(?:-wal|-shm)?|write-lock\.json)$/.test(rel)) continue;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel + '/');
      else {
        const bytes = fs.readFileSync(safePath(store.root, rel, true));
        atomicWrite(path.join(target, rel), bytes);
        manifest.push({ path: rel, hash: hash(bytes) });
      }
    }
  }
  walk(store.root);
  const dbTarget = path.join(target, '.novelclient/state.sqlite');
  fs.mkdirSync(path.dirname(dbTarget), { recursive: true });
  await backup(store.db.sql, dbTarget);
  manifest.push({ path: '.novelclient/state.sqlite', hash: fileHash(dbTarget)! });
  atomicWrite(
    path.join(target, 'wenxu-backup.json'),
    JSON.stringify({ schema: 1, createdAt: now(), projectId: store.db.project().id, manifest }, null, 2)
  );
  return target;
}
export function restoreBackup(source: string, parent: string) {
  const record = JSON.parse(fs.readFileSync(path.join(source, 'wenxu-backup.json'), 'utf8')) as {
    schema: number;
    manifest: { path: string; hash: string }[];
  };
  if (record.schema !== 1 || !Array.isArray(record.manifest)) throw new Error('不是有效文序备份');
  for (const entry of record.manifest)
    if (fileHash(safePath(source, entry.path, true)) !== entry.hash)
      throw new Error(`备份校验失败：${entry.path}`);
  const target = path.join(parent, `恢复的作品_${id().slice(0, 8)}`);
  fs.mkdirSync(target);
  for (const e of record.manifest)
    atomicWrite(safePath(target, e.path, true), fs.readFileSync(safePath(source, e.path, true)));
  return target;
}
