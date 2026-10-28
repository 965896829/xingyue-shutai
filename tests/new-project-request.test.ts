import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { newProjectRequest } from '../src/shared/new-project-request';
import { emptyTagInput } from '../src/shared/tags';
import { commandContracts } from '../src/shared/contracts';
import { Service } from '../src/core/service';

test('已有完整设定使用原始 S01 入口，并在创建时锁定作者填写的体量', async () => {
  const service = new Service(path.resolve('resources/skill'), () => {});
  const input = {
    mode: 'existing' as const, parent: fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-existing-seed-')),
    title: '死亡权', premise: '顾平安持有自己的死亡权，编号00000。', profileId: '',
    capacity: { targetWords: 2_100_000, chapterWords: 2500, minWords: 2300, maxWords: 2700 },
    creationInput: { ...emptyTagInput(), premise: '另一条策划输入，不应进入原始流程' }
  };
  try {
    const args = commandContracts['project.create'].input.parse(newProjectRequest(input));
    assert.equal('creationInput' in args, false);
    const result = await service.invoke('project.create', args);
    assert.equal(result.project!.stage, 'S01');
    assert.equal(result.project!.title, '死亡权');
    assert.equal(result.project!.config.targetWords, 2_100_000);
    assert.equal(result.project!.config.batchSize, 30);
    assert.equal(result.project!.config.preview.enabled, false);
    assert.equal(result.project!.creationWorkflow, undefined);
    assert.equal(result.tagDraft, undefined);
    assert.equal(service.store!.db.get('premise'), input.premise);
    const planning = newProjectRequest({ ...input, mode: 'planning' });
    assert.equal(planning.title, undefined);
    assert.deepEqual(planning.creationInput, input.creationInput);
    assert.equal(newProjectRequest({ ...input, previewEnabled: true }).config!.preview!.enabled, true);
    assert.throws(() => commandContracts['project.create'].input.parse(newProjectRequest({
      ...input, capacity: { ...input.capacity, minWords: 2800 }
    })), /章长/);
  } finally { service.close(); }
});
