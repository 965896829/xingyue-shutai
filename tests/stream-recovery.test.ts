import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Agent, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { invokeModel, RequestError, sse } from '../src/core/provider';
import { Service } from '../src/core/service';
import { paths, prosePath } from '../src/core/domain';
import { profileSchema, type SecretProfile } from '../src/shared/types';
import { requestErrorText, retryNeedsConfirmation, taskReplyText } from '../src/shared/run-presentation';
import { fixture } from './fixtures/workflow';
import { nativeResponse, nativeCall, nativeAnnotation, nativeText } from './fixtures/native-search';
import { mergeNativeSearch, type NativeWebSearchState } from '../src/shared/web-search';

const skill = path.resolve('resources/skill');
const profile: SecretProfile = {
  ...profileSchema.parse({
    id: 'fixture',
    name: '本地模拟',
    model: 'fixture',
    protocol: 'responses',
    baseUrl: 'http://127.0.0.1:1/v1',
    stream: true,
    contextLimit: 1000000,
    outputLimit: 4096
  }),
  apiKey: 'local-only'
};
const frame = (data: unknown, event = '') =>
  `${event ? `event: ${event}\n` : ''}data: ${JSON.stringify(data)}\n\n`;
const delta = frame({ type: 'response.output_text.delta', delta: '已收到的文字𠮷' });
const failed = frame(
  { type: 'error', code: 'upstream_stream_read_error', message: 'Upstream response stream was interrupted' },
  'error'
);
const fragment = JSON.stringify({ type: 'response.output_text.delta', delta: 'unfinished fragment' }).slice(
  0,
  49
);

test('模型等待时间覆盖底层默认空闲超时，直连与代理均按配置等待响应', async () => {
  const previous = getGlobalDispatcher();
  const shortDefault = new Agent({ headersTimeout: 20, bodyTimeout: 20 });
  setGlobalDispatcher(shortDefault);
  try {
    for (const proxy of [false, true]) {
      const server = http.createServer(async (_req, res) => {
        await new Promise(resolve => setTimeout(resolve, 80));
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(': thinking\n\n');
        await new Promise(resolve => setTimeout(resolve, 80));
        res.end(frame({ type: 'response.completed', response: { status: 'completed', output: [], usage: { input_tokens: 1, output_tokens: 1 } } }));
      });
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      try {
        const result = await invokeModel({ ...profile, baseUrl: proxy ? 'http://127.0.0.1:18443/v1' : `${address}/v1`, proxy: proxy ? address : '', timeoutSeconds: 10 }, '', [], [], new AbortController().signal);
        assert.equal(result.stop, 'complete');
      } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
    }
  } finally { setGlobalDispatcher(previous); await shortDefault.destroy(); }
});

test('中转断流保留可定位的请求编号和原因，不泄漏上游原文且不自动重发', async () => {
  let requests = 0;
  const server = http.createServer((_req, res) => {
    requests++;
    res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'relay-request-123' });
    res.end(frame({ type: 'error', code: 'upstream_http2_stream_error', message: 'Bearer private-value' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(invokeModel({ ...profile, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` }, '', [], [], new AbortController().signal), error => {
      assert.ok(error instanceof RequestError && error.uncertain);
      assert.match(error.message, /中转.*HTTP\/2.*中断/);
      assert.doesNotMatch(error.message, /private-value|Bearer/);
      assert.equal(error.diagnostic?.source, 'upstream');
      assert.equal(error.diagnostic?.requestId, 'relay-request-123');
      assert.equal(error.diagnostic?.code, 'upstream_http2_stream_error');
      assert.ok(error.diagnostic!.elapsedMs! >= 0);
      return true;
    });
    assert.equal(requests, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('配置的请求期限和作者取消仍会结束静默响应并释放连接', async () => {
  for (const cancelled of [false, true]) {
    const controller = new AbortController();
    const server = http.createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': waiting\n\n'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const timer = cancelled ? setTimeout(() => controller.abort(), 60) : undefined;
    try {
      await assert.rejects(invokeModel({ ...profile, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, timeoutSeconds: cancelled ? 10 : 0.06 }, '', [], [], controller.signal), error => {
        assert.ok(error instanceof RequestError && error.uncertain);
        assert.equal(error.diagnostic?.code, cancelled ? 'CANCELLED' : 'REQUEST_TIMEOUT');
        return true;
      });
    } finally { clearTimeout(timer); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});
test('原生搜索流式进度与引用保存；断流保留已收结果且仅发送一次', async () => {
  for (const interrupted of [false, true]) {
    let requests = 0, text = '';
    const state: NativeWebSearchState = { calls: [], citations: [] };
    const server = http.createServer((_, res) => {
      requests++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(frame({ type: 'response.web_search_call.searching', item_id: nativeCall.id }) +
        frame({ type: 'response.output_item.done', item: nativeCall }) +
        frame({ type: 'response.output_text.delta', delta: nativeText }) +
        frame({ type: 'response.output_text.annotation.added', annotation: nativeAnnotation }) +
        (interrupted ? failed : frame({ type: 'response.completed', response: nativeResponse })));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const run = invokeModel({ ...profile, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` }, '', [], [], new AbortController().signal,
        chunk => { text += chunk; }, { webSearch: { maxCalls: 1 }, onWebSearch: call => mergeNativeSearch(state, { calls: [call] }), onWebCitation: citation => mergeNativeSearch(state, { citations: [citation] }) });
      if (interrupted) await assert.rejects(run, (error: unknown) => error instanceof RequestError && error.uncertain);
      else assert.equal((await run).webSearch!.calls[0].status, 'completed');
      assert.equal(state.calls.length, 1);
      assert.equal(state.calls[0].sources.length, 1);
      assert.equal(state.citations.length, 1);
      assert.equal(text, nativeText);
      assert.equal(requests, 1);
    } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  }
});
test('中转拒绝原生 web_search 时明确提示，仅请求一次且不改用其他服务', async () => {
  let requests = 0;
  const server = http.createServer((_, res) => { requests++; res.writeHead(400); res.end('{"error":"unsupported web_search"}'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(invokeModel({ ...profile, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` }, '', [], [], new AbortController().signal, () => {}, { webSearch: { maxCalls: 1 } }), /原生 web_search.*模型和中转/);
    assert.equal(requests, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('断流后错误事件与残缺数据粘连：准确停止、保留片段且不自动重发', async () => {
  for (const wire of [
    delta + `event: response.output_text.delta\ndata: ${fragment}\n` + failed,
    delta + failed,
    delta + `data: ${fragment}`,
    delta + 'data: {"type":"response.output_text.delta","delta":"bad\tvalue"}\n\n',
    delta + 'event: error\ndata: {"type":"error","message":"private-value"}\n\n'
  ]) {
    let requests = 0,
      received = '';
    const server = http.createServer((_, res) => {
      requests++;
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const bytes = Buffer.from(wire);
      for (let i = 0; i < bytes.length; i += 3) res.write(bytes.subarray(i, i + 3));
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      await assert.rejects(
        invokeModel(
          { ...profile, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` },
          'fixture',
          [],
          [],
          new AbortController().signal,
          (text) => {
            received += text;
          }
        ),
        (error) => {
          assert.ok(error instanceof RequestError && error.uncertain);
          assert.match(error.message, /中断|格式异常/);
          assert.doesNotMatch(error.message, /Bad control|position|private-value/);
          return true;
        }
      );
      assert.equal(received, '已收到的文字𠮷');
      assert.equal(requests, 1);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});

test('正常多行 SSE、UTF-8 拆包和注释仍可解析，错误后不执行尾随成功事件', async () => {
  const wire = ': keepalive\r\ndata: {"text":\r\ndata: "中文𠮷"}\r\n\r\ndata: [DONE]\r\n\r\n';
  const bytes = Buffer.from(wire);
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
      c.close();
    }
  });
  const events = [];
  for await (const event of sse(stream)) events.push(event);
  assert.deepEqual(events, [{ text: '中文𠮷' }]);
  let cancelled = false;
  const broken = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(Buffer.from(`data: ${fragment}\n` + failed + frame({ type: 'response.completed' })));
    },
    cancel() {
      cancelled = true;
    }
  });
  await assert.rejects(async () => {
    for await (const _ of sse(broken)) assert.fail('不能采纳损坏事件');
  }, /连接中断/);
  assert.equal(cancelled, true);
});

async function setup() {
  let requests = 0;
  const service: Service = new Service(
    skill,
    () => {},
    async (_profile, _system, messages, _tools, _signal, onDelta) => {
      requests++;
      if (messages.at(-1)?.role === 'tool') {
        onDelta?.('{"status":"candidate_ready","summary":"设定拆解已保存。","artifact_proposals":[');
        throw new RequestError('模型连接中断，已保留收到的内容。', true);
      }
      const p = service.store!.db.project();
      return {
        text: '',
        native: {},
        calls: [
          {
            id: 'saved-once',
            name: 'propose_changes',
            arguments: JSON.stringify({
              changes: [
                {
                  path: paths.seed,
                  baseHash: service.store!.db.document(paths.seed)!.hash,
                  content: fixture(p, paths.seed, service)
                }
              ]
            })
          }
        ],
        usage: { input: 100, output: 20, cost: 0.01, currency: 'USD' },
        stop: 'tools'
      };
    }
  );
  service.profiles = [structuredClone(profile)];
  await service.invoke('project.create', {
    parent: fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-stream-')),
    title: '断流恢复测试',
    premise: '时间穿越',
    config: { defaultProfileId: profile.id }
  });
  return { service, requests: () => requests };
}
async function finish(service: Service) {
  const end = Date.now() + 10000;
  while (service.runner?.controller) {
    if (Date.now() > end) throw new Error('测试执行超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('完成候选后的断流可转入本地审阅，费用保持未知、重开不重发、接受仍由作者决定', async () => {
  const { service, requests } = await setup();
  try {
    const root = service.store!.root;
    const original = service.store!.read(paths.seed).content;
    await service.invoke('run.start', { request: '完成设定拆解' });
    await finish(service);
    const run = service.store!.db.runs()[0];
    assert.equal(run.status, 'unknown');
    assert.equal(requests(), 2);
    assert.equal(run.usage.cost, null);
    const checked = await service.invoke('run.revalidate', { id: run.id, reviewSaved: true });
    assert.equal(checked.status, 'awaiting_review');
    assert.ok(checked.savedCandidateReview?.error);
    assert.equal(checked.savedCandidateReview.requestUnknown, true);
    assert.match(checked.savedCandidateReview.error, /连接中断/);
    assert.equal(checked.accepted, false);
    assert.deepEqual(checked.changes, run.changes);
    assert.deepEqual(checked.messages, run.messages);
    assert.deepEqual(checked.usage, run.usage);
    assert.equal(service.store!.read(paths.seed).content, original);
    assert.equal(requests(), 2);
    assert.ok(retryNeedsConfirmation(checked));
    await assert.rejects(service.invoke('run.resume', { id: run.id }), /费用未知/);
    await assert.rejects(service.invoke('run.handoff', { id: run.id, profileId: profile.id }), /收费请求/);
    service.close();
    await service.invoke('project.open', { root });
    assert.equal(service.store!.db.run(run.id).status, 'awaiting_review');
    assert.equal(requests(), 2);
    await service.invoke('run.accept', { id: run.id, proposalHash: checked.proposalHash, startNext: false });
    assert.equal(service.store!.db.project().stage, 'S02');
    assert.equal(service.store!.read(paths.seed).content, run.changes[0].content);
    assert.equal(requests(), 2);
  } finally {
    service.close();
  }
});

test('缺失产物、待完成的章节流水线与变化的正式文件不能借恢复跳过校验', async () => {
  const { service, requests } = await setup();
  try {
    const s = service.store!;
    const run = service.makeRun('stage', '检查不完整候选');
    run.status = 'unknown';
    run.changes = [
      { path: paths.seed, content: '# 设定拆解\n待填写', baseHash: s.db.document(paths.seed)!.hash }
    ];
    run.usage.cost = null;
    s.db.saveRun(run);
    const checked = await service.invoke('run.revalidate', { id: run.id, reviewSaved: true });
    assert.equal(checked.status, 'needs_repair');
    assert.ok(checked.issues.some((i: { severity: string }) => i.severity === 'error'));
    await assert.rejects(
      service.invoke('run.accept', { id: run.id, proposalHash: checked.proposalHash }),
      /阻断问题/
    );
    fs.appendFileSync(path.join(s.root, paths.seed), '\n作者外部修改');
    await assert.rejects(
      service.invoke('run.revalidate', { id: run.id, reviewSaved: true }),
      /正式文件已变化/
    );
    const p = s.db.project();
    p.stage = 'S10';
    s.db.set('project', p);
    const chapter = service.makeRun('stage', '章节未审校');
    chapter.status = 'unknown';
    chapter.pipeline = { phase: 'review', epoch: 'test', version: 1, previewCalls: 0, proseHash: 'missing' };
    chapter.changes = [
      { path: prosePath(1), baseHash: s.db.document(prosePath(1))!.hash, content: '# 第1章\n正文片段' }
    ];
    s.db.saveRun(chapter);
    const pending = await service.invoke('run.revalidate', { id: chapter.id, reviewSaved: true });
    assert.equal(pending.status, 'needs_repair');
    assert.ok(pending.issues.some((i: { code: string }) => i.code === 'pipeline_pending'));
    assert.equal(requests(), 0);
  } finally {
    service.close();
  }
});

test('回执只显示完整摘要，流式前缀和历史英文解析错误不泄漏到主界面', () => {
  const summary = '设定已保存，保留“原始选择”。';
  const receipt = JSON.stringify({ status: 'candidate_ready', summary, artifact_proposals: [] }, null, 2);
  for (let i = 0; i <= receipt.length; i++) {
    const shown = taskReplyText(receipt.slice(0, i));
    assert.ok(shown === '' || shown === summary, JSON.stringify({ i, shown }));
  }
  assert.equal(taskReplyText('```json\n' + receipt + '\n```'), summary);
  assert.equal(taskReplyText('普通回复\n\n' + receipt), '普通回复\n\n' + summary);
  assert.equal(taskReplyText('普通正文。'), '普通正文。');
  assert.equal(taskReplyText('{"example":1}'), '{"example":1}');
  assert.equal(taskReplyText('{这是人物写的纸条}'), '{这是人物写的纸条}');
  assert.doesNotMatch(
    requestErrorText('请求异常：Bad control character in string literal in JSON at position 49'),
    /JSON|position/
  );
});
