import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CreationTimings } from '../src/core/creation-timing';
import { creationProgress, creationTimeText } from '../src/shared/creation-progress';
import { CreationProgress } from '../src/ui/CreationProgress';
import { newProject } from '../src/core/domain';
import type { Run } from '../src/shared/types';
import { fakeProfile, isolatedRoot } from './fixtures/refactor';
import { FileStore } from '../src/core/storage';
import { parseOutput } from '../src/shared/contracts';
import { Service } from '../src/core/service';
import path from 'node:path';
import fs from 'node:fs';
import { emptyTagInput } from '../src/shared/tags';

const epoch = Date.parse('2026-10-21T01:00:00Z');
const project = newProject('临时验收', 'synthetic', { defaultProfileId: fakeProfile.id });
const profiles = [{ ...fakeProfile, reasoningEffort: 'high' as const }];
function run(id = 'generation'): Run {
  return { id, status: 'running', profileId: fakeProfile.id, messages: [],
    reasoningEfforts: { [fakeProfile.id]: 'high' },
    planning: { phase: 'planning', workflowVersion: 2, origin: 'new', semanticRevisions: 0, formatRepairs: 0 }
  } as unknown as Run;
}
function memory() {
  const data = new Map<string, unknown>();
  return { get: <T,>(key: string) => data.get(key) as T | undefined, set: (key: string, value: unknown) => { data.set(key, value); }, data };
}
function record(timings: CreationTimings, store: ReturnType<typeof memory>, task: Run, start: number, seconds: number) {
  timings.begin(task, project, profiles, store, start);
  task.planning!.phase = 'awaiting_direction'; task.status = 'awaiting_input';
  timings.finish(task, store, start + seconds * 1000);
}

test('阶段依据真实工作流，保存候选、暂停和失效均不会伪装成已完成', () => {
  const task = run();
  assert.equal(creationProgress(task)?.current, 0);
  task.planning!.phase = 'reviewing_report';
  assert.equal(creationProgress(task)?.current, 1);
  task.planning!.phase = 'awaiting_direction'; task.status = 'unknown';
  assert.equal(creationProgress(task)?.finished, false);
  assert.notEqual(creationProgress(task)?.current, 2);
  task.status = 'awaiting_input';
  assert.equal(creationProgress(task)?.current, 2);
  assert.equal(creationProgress(task)?.finished, true);
  task.planning!.phase = 'contract'; task.status = 'running';
  assert.equal(creationProgress(task)?.current, 0);
  assert.equal(creationProgress(task)?.labels[0], '完善作品方案');
  task.planning!.contractReview = { result: { issues: [{ severity: 'major' }] } } as NonNullable<Run['planning']>['contractReview'];
  assert.equal(creationProgress(task)?.labels[0], '按检查意见修订');
  task.planning!.phase = 'reviewing_contract';
  assert.equal(creationProgress(task)?.labels[1], '复查修订结果');
  task.planning!.phase = 'ready'; task.status = 'paused';
  assert.equal(creationProgress(task)?.finished, false);
  task.status = 'awaiting_review';
  assert.equal(creationProgress(task)?.finished, true);
});

test('至少三次同类成功记录才估时，按模型、强度、分工、生成范围及阶段隔离', () => {
  const store = memory(), timings = new CreationTimings();
  for (let i = 0; i < 3; i++) {
    const task = run(String(i)), start = epoch + i * 1000000;
    timings.begin(task, project, profiles, store, start);
    assert.equal(timings.view(task)?.expectedSeconds, undefined);
    record(timings, store, task, start, 240 + i * 60);
  }
  const task = run('next'), at = epoch + 4000000;
  // A fresh estimator reads persisted metadata; no dependence on the old process.
  const restarted = new CreationTimings();
  restarted.begin(task, project, profiles, store, at);
  assert.equal(restarted.view(task)?.samples, 3);
  assert.deepEqual(restarted.view(task)?.expectedSeconds, { low: 204, high: 414 });
  for (const change of [
    (r: Run) => { r.reasoningEfforts![fakeProfile.id] = 'xhigh'; },
    (r: Run) => { r.planning!.phase = 'contract'; },
    (r: Run) => { r.planning!.regenerate = { directionId: 'd1', keepDirectionIds: ['d1'] } as NonNullable<Run['planning']>['regenerate']; }
  ]) {
    const other = run(); change(other); restarted.begin(other, project, profiles, store, at);
    assert.equal(restarted.view(other)?.expectedSeconds, undefined);
  }
  restarted.begin(task, project, [{ ...profiles[0], model: 'different' }], store, at);
  assert.equal(restarted.view(task)?.expectedSeconds, undefined);
  restarted.begin(task, { ...project, config: { ...project.config, modelRouting: { ...project.config.modelRouting, review: 'reviewer' } } },
    [...profiles, { ...profiles[0], id: 'reviewer', model: 'different' }], store, at);
  assert.equal(restarted.view(task)?.expectedSeconds, undefined);
  restarted.begin(task, project, [{ ...profiles[0], reasoningEffort: 'xhigh' }], store, at);
  assert.equal(restarted.view(task)?.samples, 3, '采用任务锁定的 high，不使用后来切换的全局强度');
  restarted.begin(task, project, profiles, store, at + 31 * 86400000);
  assert.equal(restarted.view(task)?.samples, 0, '过期记录不参与估算');
  assert.doesNotMatch(JSON.stringify([...store.data.values()]), /fixture-only-secret|临时验收|http:|synthetic/);
});

test('取消、断流、恢复半程及追加修订不污染普通耗时，确认等待不计时，重复结束幂等', () => {
  const store = memory(), timings = new CreationTimings();
  for (const status of ['paused', 'unknown', 'needs_repair', 'failed'] as const) {
    const task = run(status);
    timings.begin(task, project, profiles, store, epoch);
    task.status = status;
    timings.finish(task, store, epoch + 60000);
  }
  const resumed = run('resumed'); resumed.planning!.phase = 'reviewing_report';
  timings.begin(resumed, project, profiles, store, epoch);
  assert.equal(timings.view(resumed)?.unavailable, 'resumed');
  resumed.planning!.phase = 'awaiting_direction'; resumed.status = 'awaiting_input';
  timings.finish(resumed, store, epoch + 60000);
  for (const field of ['formatRepairs', 'semanticRevisions'] as const) {
    const task = run(field);
    timings.begin(task, project, profiles, store, epoch);
    task.planning![field]++;
    assert.equal(timings.view(task)?.unavailable, 'repair');
    task.planning!.phase = 'awaiting_direction'; task.status = 'awaiting_input';
    timings.finish(task, store, epoch + 60000);
  }
  assert.equal(store.data.size, 0);
  const task = run('normal');
  record(timings, store, task, epoch, 120);
  timings.finish(task, store, epoch + 86400000);
  assert.equal((Array.from(store.data.values())[0] as unknown[]).length, 1);
  task.status = 'running'; task.planning!.phase = 'contract';
  timings.begin(task, project, profiles, store, epoch + 86400000);
  task.planning!.phase = 'ready'; task.status = 'awaiting_review';
  timings.finish(task, store, epoch + 86400000 + 90000);
  assert.deepEqual((Array.from(store.data.values())[0] as {seconds: number}[]).map(value => value.seconds), [120, 90]);
});

test('估时范围不会倒数为负数或用假百分比表示，修订和超时改用真实状态', () => {
  assert.match(creationTimeText(undefined), /历史样本不足/);
  const timing = { startedAt: new Date(epoch).toISOString(), samples: 3, expectedSeconds: { low: 240, high: 420 } };
  assert.match(creationTimeText(timing, epoch), /4–7 分钟/);
  assert.match(creationTimeText(timing, epoch + 400000), /不到 1 分钟/);
  assert.match(creationTimeText(timing, epoch + 430000), /超过近期常见用时/);
  assert.match(creationTimeText({ ...timing, unavailable: 'repair' }, epoch), /追加修订/);
  const task = run(); task.creationTiming = timing;
  const html = renderToStaticMarkup(createElement(CreationProgress, { run: task }));
  assert.match(html, /aria-current="step"/);
  assert.match(html, /生成三个方向/);
  assert.doesNotMatch(html, /aria-valuenow|\d+%/);
  task.status = 'paused';
  assert.doesNotMatch(renderToStaticMarkup(createElement(CreationProgress, { run: task })), /moving|预计还需/);
});

test('本机耗时存储跨作品可用，服务推送经 IPC 校验后保留估时且不写进正式任务', async () => {
  const root = isolatedRoot('creation-timing');
  fs.mkdirSync(path.join(root, 'journal'));
  const journal = new FileStore(path.join(root, 'journal'));
  const service = new Service(path.resolve('resources/skill'), () => {});
  service.profiles = profiles;
  service.requestJournal = journal;
  try {
    await service.invoke('project.create', { parent: root, premise: '孤岛检修员',
      creationInput: { ...emptyTagInput(), premise: '孤岛检修员' }, config: { defaultProfileId: fakeProfile.id } });
    const timings = new CreationTimings();
    for (let i = 0; i < 3; i++) {
      const task = run('sample' + i), start = Date.now() - (4 - i) * 1000000;
      timings.begin(task, project, profiles, journal.db, start);
      task.status = 'awaiting_input'; task.planning!.phase = 'awaiting_direction';
      timings.finish(task, journal.db, start + 120000);
    }
    const current = service.makeRun('stage', '生成方案');
    current.status = 'running';
    current.reasoningEfforts = run().reasoningEfforts;
    service.store!.db.saveRun(current);
    // Exercise the same presentation boundary used by worker snapshots without a paid model call.
    const hostTimings = Reflect.get(service, 'creationTimings') as CreationTimings;
    hostTimings.begin(current, service.store!.db.project(), profiles, journal.db);
    const snapshot = parseOutput('app.snapshot', service.snapshot());
    assert.equal(snapshot.runs.find(value => value.id === current.id)?.creationTiming?.samples, 3);
    assert.equal(service.store!.db.run(current.id).creationTiming, undefined);
  } finally { await service.drain(); }
});
