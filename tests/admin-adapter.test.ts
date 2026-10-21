import test from 'node:test';
import assert from 'node:assert/strict';
import { configureReferenceApi, platformRow, referenceRequest } from '../src/admin/reference-api';
import { profileSchema, type Snapshot } from '../src/shared/types';
import { parseInput } from '../src/shared/contracts';

function fixture(t: import('node:test').TestContext) {
  const profile = profileSchema.parse({ id: 'model-1', connectionId: 'platform-1', name: '本地测试', baseUrl: 'http://127.0.0.1:9338/v1', model: 'fixture', protocol: 'chat', version: 3, hasKey: true, inputPrice: 2, outputPrice: 4, proxy: 'http://127.0.0.1:8080', headers: { 'x-routing': 'test' } });
  const snapshot: Snapshot = { project: null, profiles: [profile], savedProfiles: [profile], documents: [], runs: [], events: [], recent: [], facts: [], issues: [] };
  const calls: { command: string; args: any }[] = [];
  const old = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { wenxu: { invoke: async (command: string, args: any) => {
    calls.push({ command, args });
    if (command === 'app.snapshot') return { ok: true, result: snapshot };
    if (command === 'profiles.saveGroup') return { ok: true, result: [profile] };
    if (command === 'profiles.deleteGroup' || command === 'profiles.delete') return { ok: true, result: true };
    throw new Error(`unexpected command: ${command}`);
  }, cancelWait() {} } } });
  t.after(() => { if (old) Object.defineProperty(globalThis, 'window', old); else Reflect.deleteProperty(globalThis, 'window'); });
  configureReferenceApi({ client: { clientId: 'test-client' } } as any, { api: async () => { throw new Error('unexpected HTTP call'); } } as any);
  return { profile, snapshot, calls };
}
test('原后台未映射的写操作明确拒绝，预览数据不能被当作保存成功', async t => {
  const { calls } = fixture(t);
  for (const route of ['/admin/records/products', '/admin/system/themes', '/admin/engines/defaults', '/admin/records/platforms/p/actions/migrate'])
    await assert.rejects(referenceRequest(route, { method: 'POST', body: '{}' }), /尚未接入/);
  assert.equal(calls.length, 0);
  const preview = await referenceRequest('/admin/engines');
  assert.equal(preview.can_configure, false);
  assert.equal(preview.engines[0].runs, '—');
});
test('平台表单保存携带读取时版本，不能用保存时快照覆盖并发检查', async t => {
  const { profile, snapshot, calls } = fixture(t);
  const row = platformRow([profile]);
  snapshot.savedProfiles = [{ ...profile, version: 4 }];
  row.data.proxy = '';
  await referenceRequest('/admin/records/platforms/platform-1', { method: 'PUT', body: JSON.stringify({ name: row.name, status: 'disabled', data: row.data, expected_profiles: row.data.expected_profiles }) });
  const save = calls.find(c => c.command === 'profiles.saveGroup')!.args;
  assert.deepEqual(save.expectedProfiles, { 'model-1': { version: 3, enabled: true } });
  assert.equal(save.connection.proxy, '');
  assert.deepEqual(save.connection.headers, { 'x-routing': 'test' });
  assert.equal(save.models[0].enabled, false);
  assert.equal(save.apiKey, undefined, '未修改密钥时交由主进程保留加密密钥');
});
test('删除模型和平台要求版本绑定，旧表单不能绕过主进程检查', async t => {
  const { calls } = fixture(t);
  await assert.rejects(referenceRequest('/admin/records/platforms/platform-1', { method: 'DELETE' }), /刷新/);
  await assert.rejects(referenceRequest('/admin/records/models/model-1?expected_version=2', { method: 'DELETE' }), /已变化/);
  await referenceRequest('/admin/records/models/model-1?expected_version=3', { method: 'DELETE' });
  assert.deepEqual(calls.at(-1), { command: 'profiles.delete', args: { id: 'model-1', expectedVersion: 3 } });
  assert.deepEqual(parseInput('profiles.delete', { id: 'model-1', expectedVersion: 3 }), { id: 'model-1', expectedVersion: 3 });
});
test('模型成本试算使用本机单价，拒绝未知模型、负数和未支持的资源类型', async t => {
  fixture(t);
  const body = { model_id: 'model-1', resource_type: 'text', input_tokens: 1000000, output_tokens: 500000 };
  const request = (data: unknown) => referenceRequest('/admin/calculator', { method: 'POST', body: JSON.stringify(data) });
  assert.equal((await request(body)).credits, '4 USD');
  await assert.rejects(request({ ...body, input_tokens: -1 }), /非负数/);
  await assert.rejects(request({ ...body, model_id: 'missing' }), /请选择/);
  await assert.rejects(request({ ...body, resource_type: 'image' }), /文本/);
});
