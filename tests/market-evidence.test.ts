import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { collectMarketEvidence, detailTitle, parsePageState } from '../src/core/market-evidence';
import { bundledPublishingCatalog } from '../src/core/publishing';
import { type MarketRequest } from '../src/shared/market-evidence';
import { validateBookTitle } from '../src/core/title-naming';
import { storageFileName } from '../src/shared/file-names';
import { Service } from '../src/core/service';
import { isolatedRoot } from './fixtures/refactor';

const catalog = bundledPublishingCatalog(path.resolve('resources/skill'));
const request: MarketRequest = { catalogId: catalog.id, channel: 'male', categoryId: '257', rankType: 'new_book' };
const fixture = (count = 2) => '<p>统计时间截止至<!-- -->10-28 24:00</p><script>(function(){window.__INITIAL_STATE__=' + JSON.stringify({rank: {
  book_list: Array.from({ length: count }, (_, i) => ({ bookId: String(900000 + i), currentPos: i + 1, curent_category_id: 257, read_count: '270937', readCount: '0', bookName: '\ue001字', wordNumber: '288857', creationStatus: '1', lastChapterUpdateTime: '1793247600' })),
  total_num: 100, defaultPage: 1, rankVersion: '1793247600'
}}) + ';})()</script>';
test('榜单指标使用read_count，书名逐书页核验，统计日期与抓取日期分开', async () => {
  const result = await collectMarketEvidence(request, catalog, new AbortController().signal, { read: async url => url.includes('/rank/') ? fixture() : '<title>示例：书名完整版在线免费阅读_番茄小说官网</title>' });
  assert.equal(result.status, 'ready'); assert.equal(result.samples[0].readCount!.value, 270937);
  assert.equal(result.samples[0].title, '示例：书名'); assert.equal(result.samples[0].firstPublishedAt, null);
  assert.equal(result.board!.statsCutoffRaw, '10-28 24:00'); assert.notEqual(result.board!.observedAt, result.board!.statsCutoffRaw);
  assert.equal(result.board!.fullRankCoverage, false); assert.equal(result.sampleSelections.length, 2);
  assert.equal(detailTitle('<title>书名\ue000</title>'), null);
  assert.deepEqual(parsePageState('window.__INITIAL_STATE__={};throw new Error("execute")'), {}, '只解析数据，不执行脚本');
});
test('一个详情页失败不猜解私用区标题，保留部分状态且仅核验项进入选择集', async () => {
  const result = await collectMarketEvidence(request, catalog, new AbortController().signal, { read: async url => {
    if (url.includes('/rank/')) return fixture();
    if (url.endsWith('900000')) throw new Error('offline');
    return '<title>已验证标题完整版在线免费阅读</title>';
  } });
  assert.equal(result.status, 'partial'); assert.equal(result.samples[0].title, null); assert.equal(result.sampleSelections.length, 1);
  const stale = await collectMarketEvidence(request, catalog, new AbortController().signal, { cached: result, read: async () => { throw new Error('offline'); } });
  assert.equal(stale.status, 'stale'); assert.equal(stale.board!.sourceHash, result.board!.sourceHash); assert.equal(stale.observedAt, result.observedAt);
});
test('缺榜分类不伪造同名榜，近邻选择记录匹配关系，关闭联网零读取', async () => {
  const missing = catalog.options.find(o => o.channel === 'female' && o.group === 'reading.main' && !catalog.ranks.some(r => r.channel === o.channel && r.platformId === o.platformId))!;
  let calls = 0;
  const no = await collectMarketEvidence({ ...request, channel: 'female', categoryId: missing.platformId }, catalog, new AbortController().signal, { read: async () => { calls++; return fixture(); } });
  assert.equal(no.match, 'none'); assert.equal(no.status, 'unavailable'); assert.equal(calls, 0);
  const disabled = await collectMarketEvidence(request, catalog, new AbortController().signal, { enabled: false, read: async () => { calls++; return fixture(); } });
  assert.equal(disabled.status, 'disabled'); assert.equal(calls, 0);
  const nearby = await collectMarketEvidence({ ...request, categoryId: '261', referenceCategoryId: '257' }, catalog, new AbortController().signal, { read: async url => url.includes('/rank/') ? fixture() : '<title>邻类样本完整版在线免费阅读</title>' });
  assert.equal(nearby.match, 'nearby'); assert.equal(nearby.requested.platformId, '261'); assert.equal(nearby.effective!.platformId, '257');
  assert.ok(nearby.sampleSelections.every(s => s.relation === 'nearby'));
});
test('显示书名允许标点与保留名，物理目录独立且同名新作品互不覆盖', async () => {
  assert.equal(validateBookTitle('城市:明天/何处?'), '城市:明天/何处?'); assert.equal(validateBookTitle('CON'), 'CON');
  assert.doesNotMatch(storageFileName('城市:明天/何处?.docx'), /[:/?]/); assert.equal(storageFileName('CON.txt'), '_CON.txt');
  const service = new Service(path.resolve('resources/skill'), () => {}), parent = isolatedRoot('title-storage');
  try {
    const a = (await service.invoke('project.create', { parent, title: '城市:明天/何处?', premise: '城市中留下的问号。' })).project!;
    const b = (await service.invoke('project.create', { parent, title: a.title, premise: '另一部作品。' })).project!;
    assert.equal(a.title, b.title); assert.notEqual(a.root, b.root); assert.equal(path.dirname(a.root), parent);
    assert.doesNotMatch(path.basename(a.root), /[:/?]/);
    await service.invoke('project.open', { root: a.root }); assert.equal(service.store!.db.project().title, a.title);
  } finally { service.close(); }
});
