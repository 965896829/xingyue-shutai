import test from 'node:test';
import assert from 'node:assert/strict';
import { currentStageDocument } from '../src/shared/project-progress';
import { stageIds } from '../src/shared/types';
import { newProject, stageOutputs, detailPath, prosePath, updatePath, rhythmPath } from '../src/core/domain';

test('目录当前阶段与 S01—S11 实际工作流输出一致，按当前章节和批次定位', () => {
  const project = newProject('进度定位验收', 'unused', {});
  project.batches.push({ id: 'batch2', start: 31, end: 60, sizeAtCreation: 30 });
  for (const chapter of [1, 31, 60]) {
    project.chapter = chapter;
    for (const stage of stageIds) {
      project.stage = stage;
      assert.ok(stageOutputs(stage, project).includes(currentStageDocument(project)!), `${stage}, chapter ${chapter}`);
    }
  }
  project.stage = 'S09'; assert.equal(currentStageDocument(project), detailPath(60));
  project.stage = 'S10'; assert.equal(currentStageDocument(project), prosePath(60));
  project.stage = 'S11'; assert.equal(currentStageDocument(project), updatePath(60));
});

test('进度从项目状态读取，不随查看历史文件或任务倒退；完成后不标记仍在执行', () => {
  const project = newProject('进度定位验收', 'unused', {});
  project.stage = 'S10'; project.chapter = 1000;
  const before = structuredClone(project);
  assert.equal(currentStageDocument(project), prosePath(1000));
  assert.deepEqual(project, before, 'Display must not modify workflow state');
  assert.equal(currentStageDocument({ ...project, finished: true }), undefined);
});

test('兼容旧项目的批次回退；缺少批次时不编造一个文件路径', () => {
  const project = newProject('进度定位验收', 'unused', {});
  project.stage = 'S07'; project.chapter = 999;
  assert.equal(currentStageDocument(project), rhythmPath(project.batches.at(-1)!));
  assert.equal(currentStageDocument({ ...project, batches: [] }), undefined);
});
