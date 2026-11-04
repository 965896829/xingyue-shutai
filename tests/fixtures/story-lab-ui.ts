import path from 'node:path';
import type { ServerResponse } from 'node:http';
import { createServer } from 'vite';
import { Service } from '../../src/core/service';
import { RequestError } from '../../src/core/provider';
import { fakeProfile, fakeResult, isolatedRoot } from './refactor';
import { labSections } from '../../src/shared/story-lab';
import type { Command } from '../../src/shared/contracts';

const clients = new Set<ServerResponse>();
const root = isolatedRoot('story-lab-ui');
let calls = 0;
const service = new Service(
  path.resolve('resources/skill'),
  (event) => {
    for (const client of clients) client.write(`data: ${JSON.stringify(event)}\n\n`);
  },
  async (_profile, system, messages, _tools, signal, delta) => {
    calls++;
    const text = system.includes('17. 下一步创作')
      ? labSections
          .map(
            (heading, index) =>
              `## ${index + 1}. ${heading}\n\n${index === 0 ? '风停时，修伞人才听得见雨声。' : index === 2 ? '阿宁想开一家夜铺，挣够弟弟的学费。他喜欢讨价还价，却总在不该心软的时候心软。' : '旧街的夜雨带来一位陌生客人，人物在自己的欲望中作出选择，故事因此向前。'}\n`
          )
          .join('\n')
      : messages[0].content.includes('只输出选中原文的替换候选')
        ? '## 3. 主角\n\n阿宁开朗，喜欢讲冷笑话。他没有失踪的父亲。\n\n'
        : system.includes('只交小说正文')
          ? '# 第一章 夜雨借伞\n\n阿宁把最后一根伞骨穿好时，街上已经没了人声。\n\n“明早来取。”他对门口的人说。\n\n那人没有走。\n\n“可我昨天就来过了。”'
          : '核心设定可以保留。我们把他的行动动机放在夜铺开张上，让他主动接下这笔不合时宜的生意。';
    for (let i = 0; i < text.length; i += 45) {
      if (signal.aborted) throw new RequestError('本次请求已停止', true);
      delta?.(text.slice(i, i + 45));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return fakeResult(text);
  }
);
service.profiles = [{ ...fakeProfile, name: '界面测试模型（合成输出）', outputLimit: 16384, hasKey: true }];
service.storyLabRoot = path.join(root, 'story-lab');
const server = await createServer({
  server: { host: '127.0.0.1', port: 5189, strictPort: true },
  plugins: [
    {
      name: 'story-lab-ui-fixture',
      transformIndexHtml(html) {
        return html
          .replace(
            '<head>',
            `<head><script type="module">
      const listeners = new Set(); let events;
      window.wenxu = { async invoke(command, args) { const response = await fetch('/__lab/rpc', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({command,args})}); return await response.json(); }, cancelWait() {},
        onEvent(listener) { listeners.add(listener); if (!events) { events = new EventSource('/__lab/events'); events.onmessage = e => { for (const fn of listeners) fn(JSON.parse(e.data)); }; } return () => listeners.delete(listener); } };
    </script>`
          )
          .replace(/<meta[^>]+Content-Security-Policy[^>]+>/i, '');
      },
      configureServer(vite) {
        vite.middlewares.use('/__lab/events', (req, res) => {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
          });
          res.write(': ready\n\n');
          clients.add(res);
          req.on('close', () => clients.delete(res));
        });
        vite.middlewares.use('/__lab/metrics', (_req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ calls, root }));
        });
        vite.middlewares.use('/__lab/rpc', async (req, res) => {
          try {
            let body = '';
            for await (const chunk of req) body += chunk;
            const { command, args } = JSON.parse(body) as { command: Command; args: any };
            if (command === 'app.chooseDirectory') {
              res.end(JSON.stringify({ ok: true, result: root }));
              return;
            }
            const result = await service.invoke(command, args);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, result }));
          } catch (error) {
            res.end(
              JSON.stringify({
                ok: false,
                error: {
                  code: 'VALIDATION_ERROR',
                  message: (error as Error).message,
                  traceId: crypto.randomUUID(),
                  actions: []
                }
              })
            );
          }
        });
      }
    }
  ]
});
await server.listen();
console.log('Story lab UI fixture: http://127.0.0.1:5189 (synthetic model only)');
process.on(
  'SIGINT',
  () =>
    void service
      .drain()
      .then(() => server.close())
      .then(() => process.exit(0))
);
