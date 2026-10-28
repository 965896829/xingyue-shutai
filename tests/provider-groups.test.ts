import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareProviderGroup, type StoredProfile } from '../src/core/provider-groups';
import { connectionFields, modelFields } from '../src/shared/provider-groups';
import { profileSchema } from '../src/shared/types';

const legacy = (): StoredProfile => ({
  ...profileSchema.parse({
    id: 'legacy',
    name: '我的供应商',
    baseUrl: 'https://example.test/v1',
    protocol: 'responses',
    model: 'model-a',
    version: 3,
    inputPrice: 2,
    capabilities: { tools: 'verified' },
    hasKey: true
  }),
  encryptedKey: 'opaque-windows-cipher'
});
const model = (id: string) =>
  modelFields(
    profileSchema.parse({
      id: 'template',
      name: 'template',
      baseUrl: 'https://example.test/v1',
      protocol: 'responses',
      model: id
    })
  );

test('连接恢复策略逐模型保存且参与配置版本，旧模型保持默认兼容', () => {
  const old = legacy();
  assert.equal(modelFields(old).networkRecovery, undefined);
  const changed = { ...old, networkRecovery: { maxRetries: 1, retryUnknown: false } };
  const result = prepareProviderGroup([old], connectionFields(old), [modelFields(changed)]);
  assert.deepEqual(result.saved[0].networkRecovery, changed.networkRecovery);
  assert.equal(result.saved[0].version, old.version + 1);
  const again = prepareProviderGroup(result.all, connectionFields(old), [modelFields(result.saved[0])]);
  assert.equal(again.saved[0].version, result.saved[0].version);
  assert.throws(() => profileSchema.parse({ ...changed, networkRecovery: { maxRetries: 100, retryUnknown: true } }));
});

test('desktop/browser concurrent edits reject stale connection versions and model selections', () => {
  const a = legacy();
  const expected = { [a.id]: { version: a.version, enabled: true } };
  const first = prepareProviderGroup([a], connectionFields(a), [modelFields(a)], undefined, undefined, expected);
  assert.equal(first.saved[0].version, a.version);
  const changed = { ...a, version: a.version + 1 };
  assert.throws(() => prepareProviderGroup([changed], connectionFields(a), [modelFields(a)], undefined, undefined, expected), /另一处修改/);
  assert.throws(() => prepareProviderGroup([{ ...a, enabled: false }], connectionFields(a), [modelFields(a)], undefined, undefined, expected), /另一处修改/);
  assert.throws(() => prepareProviderGroup([], connectionFields(a), [modelFields(a)], undefined, undefined, expected), /另一处修改/);
  assert.throws(() => prepareProviderGroup([a], connectionFields(a), [modelFields(a)], undefined, undefined, {}), /另一处修改/);
});

test('multi-model upgrade keeps legacy ID, key, capabilities and unrelated providers', () => {
  const a = legacy(),
    other = { ...legacy(), id: 'other', model: 'other-model' };
  const result = prepareProviderGroup([a, other], connectionFields(a), [modelFields(a), model('model-b')]);
  const old = result.saved.find((p) => p.model === 'model-a')!,
    added = result.saved.find((p) => p.model === 'model-b')!;
  assert.equal(old.id, 'legacy');
  assert.equal(old.version, 3);
  assert.deepEqual(old.capabilities, { tools: 'verified' });
  assert.equal(added.connectionId, 'legacy');
  assert.equal(added.encryptedKey, a.encryptedKey);
  assert.equal(added.inputPrice, null);
  assert.equal(new Set(result.all.map((p) => p.id)).size, 3);
  assert.equal(
    result.all.find((p) => p.id === 'other'),
    other
  );
});
test('each model keeps independent parameters and only changed model loses verification', () => {
  const a = legacy();
  const first = prepareProviderGroup([a], connectionFields(a), [modelFields(a), model('model-b')]);
  const second = prepareProviderGroup(first.all, connectionFields(a), [
    { ...modelFields(a), inputPrice: 5 },
    { ...model('model-b'), contextLimit: 32000 }
  ]);
  const aa = second.saved.find((p) => p.model === 'model-a')!,
    bb = second.saved.find((p) => p.model === 'model-b')!;
  assert.equal(aa.inputPrice, 5);
  assert.equal(bb.inputPrice, null);
  assert.equal(bb.contextLimit, 32000);
  assert.equal(aa.contextLimit, 128000);
  assert.equal(aa.version, 4);
  assert.deepEqual(aa.capabilities, {});
  assert.equal(first.saved.find((p) => p.model === 'model-a')!.inputPrice, 2);
});
test('deselection and re-enabling retain IDs, parameters and old task references', () => {
  const a = legacy(),
    first = prepareProviderGroup([a], connectionFields(a), [modelFields(a), model('model-b')]);
  const off = prepareProviderGroup(first.all, connectionFields(a), [model('model-b')]);
  const disabled = off.saved.find((p) => p.model === 'model-a')!;
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.id, a.id);
  assert.equal(disabled.inputPrice, 2);
  const on = prepareProviderGroup(off.all, connectionFields(a), [modelFields(disabled), model('model-b')]);
  assert.equal(on.saved.find((p) => p.model === 'model-a')!.id, a.id);
  assert.equal(on.saved.find((p) => p.model === 'model-a')!.version, a.version);
  assert.ok(on.saved.every((p) => p.enabled));
});
test('endpoint change cannot silently reuse saved key; rotation updates inactive siblings too', () => {
  const a = legacy(),
    first = prepareProviderGroup([a], connectionFields(a), [modelFields(a), model('model-b')]);
  const changed = { ...connectionFields(a), baseUrl: 'https://different.test/v1' };
  assert.throws(() => prepareProviderGroup(first.all, changed, [model('model-b')]), /重新填写/);
  const result = prepareProviderGroup(first.all, changed, [model('model-b')], 'new-opaque-cipher');
  assert.ok(
    result.saved.every((p) => p.baseUrl === changed.baseUrl && p.encryptedKey === 'new-opaque-cipher')
  );
  assert.ok(result.saved.every((p) => Object.keys(p.capabilities).length === 0));
});
test('invalid batch is rejected before mutation; empty and duplicate selections cannot be saved', () => {
  const a = legacy(),
    original = JSON.stringify(a),
    conn = connectionFields(a);
  assert.throws(() => prepareProviderGroup([a], conn, []));
  assert.throws(() => prepareProviderGroup([a], conn, [model('model-b'), model('model-b')]), /重复/);
  assert.throws(() =>
    prepareProviderGroup([a], conn, [model('model-b'), { ...model('model-c'), outputLimit: 256000 }])
  );
  assert.throws(
    () =>
      prepareProviderGroup([a], { ...conn, headers: { Authorization: 'not-allowed' } }, [model('model-b')]),
    /密钥/
  );
  assert.equal(JSON.stringify(a), original);
});
test('new provider preserves explicit disabled state without reusing unrelated keys or trusting IDs and capabilities', () => {
  const a = legacy(),
    result = prepareProviderGroup([a], { ...connectionFields(a), id: 'new-provider' }, [
      {
        ...model('model-a'),
        id: 'legacy',
        connectionId: 'legacy',
        capabilities: { tools: 'verified' },
        enabled: false
      }
    ]);
  assert.equal(result.saved[0].id, 'new-provider');
  assert.equal(result.saved[0].encryptedKey, '');
  assert.deepEqual(result.saved[0].capabilities, {});
  assert.equal(result.saved[0].enabled, false);
  assert.equal(
    result.all.find((p) => p.id === 'legacy'),
    a
  );
});
test('saving an unchanged group does not invalidate pending tasks', () => {
  const a = legacy(),
    first = prepareProviderGroup([a], connectionFields(a), [modelFields(a), model('model-b')]);
  const again = prepareProviderGroup(
    first.all,
    connectionFields(first.saved[0]),
    first.saved.map(modelFields)
  );
  assert.deepEqual(again, first);
});
