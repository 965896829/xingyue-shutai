import http from 'node:http';
const labels = [
  '原始设定',
  '题材类型',
  '一句话卖点',
  '核心神级点',
  '主角初始困境',
  '世界不公平规则',
  '主角破局方式',
  '最大反差',
  '第一章核心事件',
  '长线连载动力',
  '爽点升级路线',
  '风险与修正'
];
http
  .createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}'),
      messages = body.messages ?? [],
      last = messages.at(-1);
    let message = { role: 'assistant', content: '本地协议测试 pong' };
    if (messages.some((m) => m.content?.includes('authorPremise'))) {
      const old = messages.find((m) => m.role === 'tool' && m.tool_call_id === 'read-seed');
      if (!old)
        message = {
          role: 'assistant',
          content: '先读取当前设定文件。',
          tool_calls: [
            {
              id: 'read-seed',
              type: 'function',
              function: {
                name: 'read_document',
                arguments: JSON.stringify({ path: '01_设定拆解/设定拆解.md' })
              }
            }
          ]
        };
      else if (last.role === 'tool' && last.tool_call_id === 'read-seed')
        message = {
          role: 'assistant',
          content: '已读取原文件，提出设定候选。',
          tool_calls: [
            {
              id: 'write-seed',
              type: 'function',
              function: {
                name: 'propose_changes',
                arguments: JSON.stringify({
                  changes: [
                    {
                      path: '01_设定拆解/设定拆解.md',
                      baseHash: JSON.parse(old.content).hash,
                      content:
                        '# 设定拆解\n\n' +
                        labels
                          .map(
                            (l) =>
                              `- ${l}：阿宁必须在三日内带着未愈的左手伤势找到药方，代价与期限构成持续冲突。`
                          )
                          .join('\n')
                    }
                  ]
                })
              }
            }
          ]
        };
      else
        message = {
          role: 'assistant',
          content:
            '设定候选已经保存。请检查十二个字段，并决定是否接受。此结果来自本地模拟服务，不代表真实模型文学质量。'
        };
    }
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: message.content } }] })}\n\n`
      );
      if (message.tool_calls)
        for (const call of message.tool_calls)
          res.write(
            `data: ${JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, ...call }] } }] })}\n\n`
          );
      res.write(
        `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 100, completion_tokens: 50 } })}\n\n`
      );
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 100, completion_tokens: 50 }
        })
      );
    }
  })
  .listen(19452, '127.0.0.1', () =>
    console.log('Local fixture endpoint listening on 127.0.0.1:19452; no external model calls.')
  );
