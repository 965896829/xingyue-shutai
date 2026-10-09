import fs from 'node:fs';
import path from 'node:path';
import { FileStore, safePath } from './storage';
import { newProject, paths, id, now } from './domain';
import { configSchema, stageIds } from '../shared/types';
import { z } from 'zod';
export function previewLegacy(source: string) {
  const files: { path: string; bytes: number; warning?: string }[] = [];
  const walk = (dir: string, prefix = '') => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
      const rel = prefix + e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), rel + '/');
      else if (rel.endsWith('.md'))
        files.push({
          path: rel,
          bytes: fs.statSync(safePath(source, rel)).size,
          warning: rel.startsWith('04_') ? '旧档案无结构化证据的条目，来源待核对' : undefined
        });
    }
  };
  walk(source);
  return {
    files,
    suggestedChapter: Math.max(0, ...files.map((f) => Number(f.path.match(/^07_.*第(\d+)章/)?.[1] ?? 0))) + 1,
    warnings: [
      '保持原档案字节，创建独立副本。原始来源不作修改。',
      '旧进度仅供参考；请明确选择继续的章号和阶段。',
      '旧人物与台账需逐项记录来源核对结果，不能由导入自动证明为事实。'
    ]
  };
}
export function importLegacy(args: unknown) {
  const a = z
      .object({
        source: z.string(),
        parent: z.string(),
        title: z.string().min(1),
        chapter: z.number().int().positive(),
        stage: z.enum(stageIds),
        config: configSchema
      })
      .parse(args),
    preview = previewLegacy(a.source);
  const root = path.join(a.parent, `导入作品_${id().slice(0, 8)}`);
  fs.mkdirSync(root);
  const s = new FileStore(root);
  try {
    const p = newProject(a.title, root, a.config);
    p.stage = a.stage;
    p.chapter = a.chapter;
    p.revision = 1;
    p.acceptedImport = false;
    p.stale = preview.files.filter((f) => f.warning).map((f) => f.path);
    p.batches = [];
    for (let n = 1; n <= a.chapter; n += a.config.batchSize)
      p.batches.push({
        id: id(),
        start: n,
        end: Math.min(n + a.config.batchSize - 1, Math.ceil(a.config.targetWords / a.config.chapterWords)),
        sizeAtCreation: a.config.batchSize
      });
    if (p.batches.at(-1)!.end < a.chapter) throw new Error('继续章号超出目标总章数，请先调整项目容量');
    const changes = preview.files.map((f) => {
      const raw = fs.readFileSync(safePath(a.source, f.path));
      new TextDecoder('utf-8', { fatal: true }).decode(raw);
      return { path: f.path, content: raw.toString('utf8'), baseHash: null };
    });
    s.commit(changes, p);
    s.db.set('migration', {
      source: a.source,
      at: now(),
      files: preview.files,
      approvedStage: a.stage,
      approvedChapter: a.chapter
    });
    s.db.set('premise', s.db.document(paths.seed) ? s.read(paths.seed).content : '旧档案导入');
    return root;
  } finally {
    s.close();
  }
}
