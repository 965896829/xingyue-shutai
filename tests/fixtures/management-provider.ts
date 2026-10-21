/** Local-only deterministic provider for browser/desktop management acceptance.
 * Catalog + connection checks succeed; generation streams until explicitly cancelled.
 * No external model or paid request is made. Start with: node --import tsx tests/fixtures/management-provider.ts
 */
import http from 'node:http';
const streamDelay = Math.max(0, Number(process.env.WENXU_FIXTURE_STREAM_DELAY_MS) || 0);
let requests = 0;
const observed: { model: string; protocol: string; effort: string | null }[] = [];
const server = http.createServer(async (req, res) => {
  if (req.url === '/status') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ requests, observed }));
    return;
  }
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        object: 'list',
        data: ['management-fixture-v1', 'management-fixture-v2', 'gpt-6.1-sol', 'gpt-6-astra'].map((id) => ({
          id,
          object: 'model',
          owned_by: 'local-test'
        }))
      })
    );
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  requests++;
  const input = JSON.parse(body);
  observed.push({ model: input.model, protocol: req.url?.endsWith('/responses') ? 'responses' : 'chat', effort: input.reasoning?.effort ?? input.reasoning_effort ?? null });
  if (req.url?.endsWith('/responses')) {
    const text = body.includes('Reply exactly pong.') ? 'pong' : '这是本机合成验收回复，未调用外部模型。';
    const result = { id: `fixture-${requests}`, status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage: { input_tokens: 16, output_tokens: 16 } };
    if (input.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      if (streamDelay && !body.includes('Reply exactly pong.')) {
        res.flushHeaders();
        const wait = () => new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); res.off('close', done); resolve(); };
          const timer = setTimeout(done, streamDelay);
          res.once('close', done);
        });
        const emit = (event: unknown) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
        await wait();
        emit({ type: 'response.output_item.added', item: { type: 'reasoning' } });
        await wait();
        emit({ type: 'response.output_text.delta', delta: text.slice(0, 10) });
        await wait();
        emit({ type: 'response.output_text.delta', delta: text.slice(10) });
        await wait();
        emit({ type: 'response.completed', response: result });
        res.end();
        return;
      }
      res.end(`data: ${JSON.stringify({ type: 'response.output_text.delta', delta: text })}\n\ndata: ${JSON.stringify({ type: 'response.completed', response: result })}\n\n`);
    } else { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(result)); }
    return;
  }
  if (body.includes('Reply exactly pong.')) {
    if (JSON.parse(body).stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(
        'data: {"id":"test-pong","choices":[{"index":0,"delta":{"content":"pong"},"finish_reason":null}]}\n\ndata: {"id":"test-pong","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":4,"completion_tokens":1}}\n\ndata: [DONE]\n\n'
      );
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        id: 'test-pong',
        choices: [{ index: 0, message: { role: 'assistant', content: 'pong' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 4, completion_tokens: 1 }
      })
    );
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  res.write(
    'data: {"choices":[{"index":0,"delta":{"content":"仅用于管理联调的合成输出，等待停止任务。"},"finish_reason":null}]}\n\n'
  );
});
server.listen(9338, '127.0.0.1', () => console.log('Management acceptance provider: http://127.0.0.1:9338'));
