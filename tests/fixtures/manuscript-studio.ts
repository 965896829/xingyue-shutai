import fs from 'node:fs';
import type { Service } from '../../src/core/service';
import type { ProjectState, Run } from '../../src/shared/types';
import { detailPath, prosePath, paths, hash } from '../../src/core/domain';
import { playbackPlan, playbackProse } from './streaming-content';

export const roleFixture = '# 角色卡\n\n## 林川\n- 重要度：主角；稳定标识 CH001；别称“阿川”\n- 身份：维修工\n- 当前目标：修好水泵\n- 伤势：右手受伤\n\n## 赵宁\n- 重要度：配角；稳定标识 CH002\n- 身份：医生\n- 当前目标：帮助伤员\n';
export async function createManuscriptFixture(service: Service, parent: string, samplePath?: string) {
  const sample = samplePath ? JSON.parse(fs.readFileSync(samplePath, 'utf8')) as { project: ProjectState; documents: { path: string; content: string }[]; run: Run } : undefined;
  await service.invoke('project.create', { parent, title: sample?.project.title ?? '文稿与人物资料验收', premise: '隔离副本，仅用于展示验收。', config: { defaultProfileId: 'fixture', expressionRules: { enabled: false }, preview: { enabled: false, maxCalls: 8 } } });
  const store = service.store!, project = store.db.project();
  project.stage = 'S10'; project.revision++; project.chapter = sample?.project.chapter ?? 1;
  const documents = sample?.documents ?? [
    { path: paths.roles, content: roleFixture },
    { path: paths.relations, content: '# 关系\n\n| 人物A | 人物B | 关系 |\n| --- | --- | --- |\n| 林川 | 赵宁 | 相互试探 |' },
    { path: paths.timeline, content: '# 时间线\n\n| 章节 | 故事时间 | 事件 |\n| --- | --- | --- |\n| 001 | 断水当日清晨 | 林川检查水泵 |' },
    { path: detailPath(1), content: playbackPlan }
  ];
  store.commit(documents.filter(doc => /^0[4-8]_/.test(doc.path)).map(doc => ({ ...doc, baseHash: store.db.document(doc.path)?.hash ?? null })), project);
  const fresh = service.makeRun('stage', '展示已生成正文和资料', 'fixture');
  const run = sample ? { ...sample.run, id: fresh.id, projectId: project.id, baseRevision: project.revision, baseSnapshotId: fresh.baseSnapshotId, basisRevision: project.revision, manifest: fresh.manifest,
    profileId: 'fixture', messages: [], toolResults: {}, steps: [], usage: fresh.usage } : fresh;
  run.changes = (sample?.run.changes ?? [
    { path: prosePath(1), content: playbackProse },
    { path: paths.roles, content: roleFixture.replace('右手受伤', '右手包扎，暂时不能负重') },
    { path: paths.relations, content: documents[1].content.replace('相互试探', '约定合作') }
  ]).map(change => ({ ...change, baseHash: store.db.document(change.path)?.hash ?? null }));
  run.status = 'awaiting_review'; run.accepted = false;
  run.pipeline = { ...fresh.pipeline!, ...run.pipeline, phase: 'ready', proseHash: hash(run.changes.find(change => change.path === prosePath(project.chapter))!.content) };
  store.db.saveRun(run);
  return { run, project: store.db.project() };
}
