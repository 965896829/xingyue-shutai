import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const evidence = path.resolve('.test-output/refactor/desktop-provider.json');
let requests = 0;
fs.writeFileSync(evidence, JSON.stringify({ requests, pid: process.pid }));
const server = http.createServer(async (request, response) => {
  for await (const _chunk of request) {}
  requests++;
  fs.writeFileSync(evidence, JSON.stringify({ requests, pid: process.pid, url: request.url, dispatchedAt: new Date().toISOString() }));
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.write('data: {"choices":[{"delta":{"content":"合成未完成片段"}}]}\n\n');
});
server.listen(9338, '127.0.0.1', () => console.log('Synthetic provider listening on 127.0.0.1:9338'));
