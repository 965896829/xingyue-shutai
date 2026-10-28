import type { ProjectState } from './types';

/** The workflow position belongs to the project, independently of the document or historical run being viewed. */
export function currentStageDocument(project: Pick<ProjectState, 'stage' | 'chapter' | 'batches' | 'finished'>): string | undefined {
  if (project.finished) return undefined;
  const chapter = `第${String(project.chapter).padStart(3, '0')}章`;
  const batch = project.batches.find(b => project.chapter >= b.start && project.chapter <= b.end) ?? project.batches.at(-1);
  const range = batch && `第${String(batch.start).padStart(3, '0')}-${String(batch.end).padStart(3, '0')}章`;
  return {
    S01: '01_设定拆解/设定拆解.md',
    S02: '02_项目配置/项目配置.md',
    S03: '03_世界规则与卖点/世界规则与卖点.md',
    S04: '04_人物记忆库/角色卡.md',
    S05: '05_长篇大纲/分卷大纲.md',
    S06: '05_长篇大纲/章节总纲.md',
    S07: range ? `05_长篇大纲/${range}节奏.md` : undefined,
    S08: range ? `06_章节设计/${range}细纲.md` : undefined,
    S09: `06_章节设计/${chapter}细纲.md`,
    S10: `07_正文章节/${chapter}.md`,
    S11: `08_章后更新/${chapter}记忆更新.md`
  }[project.stage];
}
