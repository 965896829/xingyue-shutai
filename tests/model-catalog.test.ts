import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { fetchModelCatalog, resolveCatalogConnection } from '../src/core/model-catalog';
import { requestBody } from '../src/core/provider';
import { profileSchema } from '../src/shared/types';

async function server(handler: http.RequestListener, run: (baseUrl: string) => Promise<void>) {
  const s = http.createServer(handler);
  await new Promise<void>((resolve) => s.listen(0, '127.0.0.1', resolve));
  try { await run(`http://127.0.0.1:${(s.address() as import('node:net').AddressInfo).port}/v1`); }
  finally { s.closeAllConnections(); await new Promise<void>((resolve) => s.close(() => resolve())); }
}
const json = (res: http.ServerResponse, body: unknown) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };

test('未保存、未选择模型的连接可读取列表，去重并忽略无效项目', async () => {
  let count = 0;
  await server((req, res) => {
    count++;
    assert.equal(req.method, 'GET'); assert.equal(req.url, '/v1/models');
    assert.equal(req.headers.authorization, 'Bearer test-new-key');
    assert.equal(req.headers['x-tenant'], 'test');
    json(res, { data: [{ id: 'z' }, null, {}, { id: 17 }, { id: 'z' }, { id: 'a', owned_by: 'local' }] });
  }, async (baseUrl) => {
    for (const protocol of ['responses', 'chat', 'images']) {
      const result = await fetchModelCatalog(resolveCatalogConnection({ protocol, baseUrl, headers: { 'x-tenant': 'test' } }, 'test-new-key'));
      assert.deepEqual(result.models.map((m) => m.id), ['a', 'z']);
      assert.equal(result.models[0].owner, 'local'); assert.equal(result.truncated, false);
    }
  });
  assert.equal(count, 3);
});

test('已有密钥只能用于同一连接地址，换地址必须重填；凭据与 Host 请求头不能旁路', () => {
  const saved = { id: 'p', baseUrl: 'https://example.test/v1', apiKey: 'stored-test-key' };
  const draft = { id: 'p', protocol: 'chat', baseUrl: saved.baseUrl + '/' };
  assert.equal(resolveCatalogConnection(draft, '', saved).apiKey, saved.apiKey);
  assert.throws(() => resolveCatalogConnection({ ...draft, baseUrl: 'https://other.test/v1' }, '', saved), /重新填写/);
  assert.throws(() => resolveCatalogConnection({ ...draft, id: 'other' }, '', saved), /重新填写/);
  assert.equal(resolveCatalogConnection({ ...draft, baseUrl: 'https://other.test/v1' }, 'replacement', saved).apiKey, 'replacement');
  for (const h of ['Authorization', 'x-api-key', 'X-Goog-Api-Key', 'cookie', 'Host'])
    assert.throws(() => resolveCatalogConnection({ ...draft, headers: { [h]: 'bad' } }, ''), /请求头/);
  assert.throws(() => resolveCatalogConnection({ ...draft, baseUrl: 'http://example.test/v1' }, ''), /HTTPS/);
  assert.throws(() => resolveCatalogConnection({ ...draft, baseUrl: 'https://example.test/v1?key=bad' }, ''), /查询/);
});

test('Anthropic 模型分页使用原生鉴权和 after_id', async () => {
  let calls = 0;
  await server((req, res) => {
    calls++;
    assert.equal(req.headers['x-api-key'], 'test-key');
    assert.equal(req.headers['anthropic-version'], '2023-06-01');
    assert.equal(req.headers.authorization, undefined);
    if (calls === 1) json(res, { data: [{ id: 'claude-a', display_name: 'Claude A' }], has_more: true, last_id: 'claude-a' });
    else { assert.equal(req.url, '/v1/models?after_id=claude-a'); json(res, { data: [{ id: 'claude-b' }], has_more: false }); }
  }, async (baseUrl) => {
    const r = await fetchModelCatalog(resolveCatalogConnection({ protocol: 'anthropic', baseUrl }, 'test-key'));
    assert.deepEqual(r.models.map((v) => v.id), ['claude-a', 'claude-b']); assert.equal(r.models[0].name, 'Claude A');
  });
  assert.equal(calls, 2);
});

test('Gemini 分页、去掉 models/ 前缀，过滤仅嵌入模型；选择后生成路径正确', async () => {
  let calls = 0;
  await server((req, res) => {
    calls++; assert.equal(req.headers['x-goog-api-key'], 'test-key');
    if (calls === 1) json(res, { models: [{ name: 'models/gemini-test', displayName: 'Gemini Test', supportedGenerationMethods: ['generateContent'] }, { name: 'models/embed', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'p+2' });
    else { assert.match(req.url!, /pageToken=p%2B2/); json(res, { models: [{ name: 'models/gemini-other' }] }); }
  }, async (baseUrl) => {
    const r = await fetchModelCatalog(resolveCatalogConnection({ protocol: 'gemini', baseUrl }, 'test-key'));
    assert.deepEqual(r.models.map((v) => v.id), ['gemini-other', 'gemini-test']);
    const p = { ...profileSchema.parse({ id: 'p', name: 'p', protocol: 'gemini', baseUrl, model: r.models[1].id, stream: false }), apiKey: 'test-key' };
    assert.equal(requestBody(p, '', [], []).url, `${baseUrl}/models/gemini-test:generateContent`);
  });
  assert.equal(calls, 2);
});

test('错误状态不泄漏服务端内容，空列表和错误格式明确区分', async () => {
  for (const code of [401, 403, 404, 429, 500]) {
    await server((_, res) => { res.statusCode = code; res.end('sensitive-test-server-content'); }, async (baseUrl) => {
      await assert.rejects(fetchModelCatalog(resolveCatalogConnection({ protocol: 'chat', baseUrl }, 'test-key')), (e: Error) => e.message.includes(`HTTP ${code}`) && !e.message.includes('sensitive'));
    });
  }
  await server((_, res) => json(res, { data: [] }), async (baseUrl) => {
    assert.deepEqual((await fetchModelCatalog(resolveCatalogConnection({ protocol: 'chat', baseUrl }, ''))).models, []);
  });
  await server((_, res) => json(res, { login: 'admin page' }), async (baseUrl) => {
    await assert.rejects(fetchModelCatalog(resolveCatalogConnection({ protocol: 'chat', baseUrl }, '')), /没有可识别/);
  });
});

test('重复分页游标和过大列表有明确截断标记', async () => {
  let count = 0;
  await server((_, res) => { count++; json(res, { data: [{ id: 'a' }], has_more: true, last_id: 'a' }); }, async (baseUrl) => {
    const r = await fetchModelCatalog(resolveCatalogConnection({ protocol: 'anthropic', baseUrl }, ''));
    assert.equal(r.truncated, true); assert.equal(r.models.length, 1);
  });
  assert.equal(count, 2);
  await server((_, res) => json(res, { data: Array.from({ length: 2002 }, (_, i) => ({ id: `m-${i}` })) }), async (baseUrl) => {
    const r = await fetchModelCatalog(resolveCatalogConnection({ protocol: 'chat', baseUrl }, ''));
    assert.equal(r.truncated, true); assert.equal(r.models.length, 2000);
  });
});

test('列表请求禁止跟随重定向，避免把认证发送到其他地址', async () => {
  let leaked = false;
  await server((_, res) => { leaked = true; json(res, { data: [] }); }, async (other) => {
    await server((_, res) => { res.writeHead(302, { location: `${other}/models` }); res.end(); }, async (baseUrl) => {
      await assert.rejects(fetchModelCatalog(resolveCatalogConnection({ protocol: 'responses', baseUrl }, 'test-key')), /无法连接/);
    });
  });
  assert.equal(leaked, false);
});
