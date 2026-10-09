import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from '../tests/fixtures/workflow';
import { prosePath, qualityPath, stageOutputs } from '../src/core/domain';
import type { Service } from '../src/core/service';
import type { ProjectState, Run } from '../src/shared/types';

const qa = JSON.parse(fs.readFileSync('.test-output/studio-qa-current.json', 'utf8'));
if (!path.resolve(qa.root).startsWith(path.resolve('.test-output') + path.sep))
  throw new Error('仅用于隔离验收作品');
const server = createServer(async (req, res) => {
  if (req.url === '/v1/models') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'studio-fixture' }] }));
    return;
  }
  if (req.url !== '/v1/chat/completions') {
    res.writeHead(404).end();
    return;
  }
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const db = new DatabaseSync(path.join(qa.root, '.novelclient/state.sqlite'), { readOnly: true });
    let text = '',
      calls: any[] = [],
      kind = '';
    try {
      const p = JSON.parse(
        (db.prepare("SELECT value FROM kv WHERE key='project'").get() as any).value
      ) as ProjectState;
      const runs = () =>
        (db.prepare('SELECT data FROM runs ORDER BY rowid DESC').all() as any[]).map(
          (r) => JSON.parse(r.data) as Run
        );
      const shim = {
        store: {
          db: {
            project: () => p,
            runs,
            document: (file: string) => db.prepare('SELECT * FROM documents WHERE path=?').get(file)
          },
          read: (file: string) => ({ content: fs.readFileSync(path.join(qa.root, file), 'utf8') })
        }
      } as unknown as Service;
      const system = input.messages
        .filter((m: any) => m.role === 'system')
        .map((m: any) => m.content)
        .join('\n');
      if (!input.tools?.length) {
        if (system.includes('rubric narrative-1')) {
          const supplied = JSON.parse(input.messages.at(-1).content).text;
          text = JSON.stringify({
            values: { pressure: 3, payoff: 2, emotion: 3, revelation: null, relationship: null },
            quotes: [supplied.slice(-12)],
            note: '本地验收样本'
          });
          kind = 'assessment';
        } else {
          text = fixture(p, prosePath(p.chapter), shim);
          kind = 'prose';
        }
      } else if (input.messages.at(-1).role === 'tool') {
        text = '候选完成';
        kind = 'tool-result';
      } else {
        const phase = runs().find((r) => r.status === 'running')?.pipeline?.phase;
        const outputs =
          phase === 'review'
            ? [qualityPath(p.chapter)]
            : stageOutputs(phase === 'memory' ? 'S11' : p.stage, p);
        const changes = outputs.map((file) => ({
          path: file,
          baseHash: (db.prepare('SELECT hash FROM documents WHERE path=?').get(file) as any)?.hash ?? null,
          content: fixture(p, file, shim)
        }));
        calls = [
          {
            id: 'qa-' + Date.now(),
            type: 'function',
            function: { name: 'propose_changes', arguments: JSON.stringify({ changes }) }
          }
        ];
        kind = phase ?? p.stage;
      }
    } finally {
      db.close();
    }
    fs.appendFileSync(
      path.join(qa.directory, 'model-calls.jsonl'),
      JSON.stringify({
        at: new Date().toISOString(),
        kind,
        model: input.model,
        tools: (input.tools ?? []).map((t: any) => t.function.name)
      }) + '\n'
    );
    if (input.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (delta: any, finish_reason: string | null = null) =>
        res.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta, finish_reason }] }) + '\n\n');
      if (calls.length) send({ tool_calls: calls.map((v, i) => ({ ...v, index: i })) });
      else
        for (let i = 0; i < text.length; i += 40) {
          send({ content: text.slice(i, i + 40) });
          await new Promise((r) => setTimeout(r, 80));
        }
      send({}, calls.length ? 'tool_calls' : 'stop');
      res.write(
        'data: ' +
          JSON.stringify({ choices: [], usage: { prompt_tokens: 64, completion_tokens: 220 } }) +
          '\n\n'
      );
      res.end('data: [DONE]\n\n');
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          choices: [
            {
              message: { role: 'assistant', content: text, tool_calls: calls.length ? calls : undefined },
              finish_reason: calls.length ? 'tool_calls' : 'stop'
            }
          ],
          usage: { prompt_tokens: 64, completion_tokens: 220 }
        })
      );
    }
  } catch (e) {
    res.writeHead(500).end(JSON.stringify({ error: (e as Error).message }));
  }
});
server.listen(19457, '127.0.0.1', () => console.log('Studio QA model ready: 127.0.0.1:19457'));
