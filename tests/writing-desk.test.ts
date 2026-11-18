import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { Service } from '../src/core/service';
import { batchPath, rhythmPath, hash, prosePath } from '../src/core/domain';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { manuscriptEditSchema, manuscriptTarget, mergeManuscript, replaceManuscriptPassage, requestedChapter, requestsManuscript } from '../src/shared/manuscript-edit';

const file = '07_正文章节/第001章.md';
test('选区跟随原文移动，只替换选中的重复句，拒绝覆盖冲突', () => {
  const text = '甲。\n灯亮了。\n乙🌙。\n灯亮了。\n结尾。', line = '灯亮了。', from = text.lastIndexOf(line);
  const target = manuscriptTarget('book', file, text, { from, to: from + line.length });
  const expected = text.slice(0, from) + '天亮了。' + text.slice(from + line.length);
  assert.ok(manuscriptEditSchema.safeParse(target).success);
  assert.equal(replaceManuscriptPassage(text, target, '天亮了。', text), expected);
  assert.equal(replaceManuscriptPassage('序。\n' + text, target, '天亮了。', text), '序。\n' + expected);
  assert.equal(replaceManuscriptPassage(text + '后记。', target, '天亮了。', text), expected + '后记。');
  assert.equal(replaceManuscriptPassage(text.slice(0, from) + '作者的修改。', target, '天亮了。', text), null);
  assert.equal(replaceManuscriptPassage(text, target, '天亮了。'), expected);
  const repeated = '同一句。\n同一句。\n';
  assert.equal(replaceManuscriptPassage('同一句。\n', manuscriptTarget('book', file, repeated, { from: 0, to: 4 }), '改写', repeated), null);
});
test('流式追加与作者编辑可以合并，冲突保留作者的手稿', () => {
  const base = '🌙第一段。\r\n第二段。';
  assert.deepEqual(mergeManuscript(base, base.replace('第一', '开头'), base + '第三段。'),
    { text: base.replace('第一', '开头') + '第三段。', conflict: false });
  assert.deepEqual(mergeManuscript(base, '作者重写。', '模型重写。'), { text: '作者重写。', conflict: true });
  assert.deepEqual(mergeManuscript('', '手写', '模型'), { text: '手写', conflict: true });
  const target = manuscriptTarget('book', file, base);
  assert.equal(replaceManuscriptPassage(base + '作者写了。', target, '整章重写'), null);
});
test('明确的写作指令绑定指定章节，提问留在对话里', () => {
  assert.equal(requestsManuscript('请写第一章，雨夜开场'), true);
  assert.equal(requestsManuscript('按前章结尾写第二章，保留门外的脚印。'), true);
  assert.equal(requestedChapter('请按前章结尾写第二章', 5), 2);
  assert.equal(requestsManuscript('不要按前章结尾写第二章'), false);
  assert.equal(requestsManuscript('按前章结尾写第二章合适吗？'), false);
  assert.equal(requestedChapter('帮我写第二十一章，五百字', 4), 21);
  assert.equal(requestedChapter('写第003章', 1), 3);
  assert.equal(requestedChapter('续写下一章', 2), 3);
  assert.equal(requestedChapter('写本章，人物提到第二章', 4), 4);
  assert.equal(requestedChapter('写本章，别写第二章', 4), 4);
  assert.equal(requestsManuscript('第一章适合如何开场？'), false);
  assert.equal(requestsManuscript('写第一章需要什么？'), false);
});

test('正文改写绑定作品和章节，保留正式稿，旧候选无法覆盖新版本', async () => {
  let payload = '', toolCount = -1, requests = 0;
  const service = new Service(path.resolve('resources/skill'), () => {}, async (_profile, _system, messages, tools, _signal, delta) => {
    requests++; toolCount = tools.length; payload = String(messages.at(-1)?.content);
    delta?.('春雨落下。');
    return fakeResult('春雨落下。');
  });
  service.profiles = [structuredClone(fakeProfile)];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('writing-desk'), title: '正文工作台', premise: '一封信送到山门。',
      config: { defaultProfileId: fakeProfile.id, expressionRules: { enabled: false } } });
    const store = service.store!, p = store.db.project();
    store.commit([service.change(prosePath(1), '山门打开了。')], p);
    const chat = await service.invoke('chat.create', { title: '写第二章' });
    const target = manuscriptTarget(p.id, prosePath(2), '雨停了。', { from: 0, to: 4 });
    await assert.rejects(service.invoke('chat.send', { conversationId: chat.id, text: '调整天气', manuscript: { ...target, projectId: 'other' } }), /作品/);
    const id = await service.invoke('chat.send', { conversationId: chat.id, text: '调整天气', manuscript: target });
    for (let n = 0; n < 400 && (await service.invoke('chat.manuscript', { id })).message.status === 'running'; n++)
      await new Promise(resolve => setTimeout(resolve, 25));
    const reply = await service.invoke('chat.manuscript', { id });
    assert.equal(reply.message.status, 'complete');
    assert.equal(reply.message.content, '春雨落下。');
    assert.equal(requests, 1);
    assert.equal(toolCount, 0);
    assert.deepEqual(reply.target, target);
    assert.equal(JSON.parse(payload).original, '雨停了。');
    const turn = (await service.invoke('chat.read', { id: chat.id })).turns.find(t => t.id === id)!;
    assert.equal(turn.manifest?.chapter, 2);
    assert.equal(turn.manifest?.purpose, 'draft');
    assert.equal(store.readAccepted(prosePath(1)).content, '山门打开了。');
    assert.equal(store.db.project().chapter, 1);
    const manualId = await service.invoke('document.save', { path: prosePath(2), baseHash: null, content: '旧候选' });
    await service.invoke('run.update', { id: manualId, path: prosePath(2), content: '新候选', expectedHash: hash('旧候选') });
    await assert.rejects(service.invoke('run.update', { id: manualId, path: prosePath(2), content: '过期写入', expectedHash: hash('旧候选') }), /候选已更新/);
    assert.equal(store.db.run(manualId).changes[0].content, '新候选');
  } finally { await service.drain(); }
});

test('进度第五章时，实际出站分别使用第31和第2章的批次及前章版本，缺纲请求停在本机', async () => {
  const wires: { system: string; input: string }[] = [];
  const service = new Service(path.resolve('resources/skill'), () => {}, async (_p, system, messages) => {
    wires.push({ system, input: messages.at(-1)!.content }); return fakeResult('合成正文候选。');
  });
  service.profiles = [structuredClone(fakeProfile)];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('target-batch'), title: '合成章节', premise: '渡河', config: { defaultProfileId: fakeProfile.id } });
    const store = service.store!, project = store.db.project(); project.chapter = 5; project.revision++;
    const first = project.batches[0], second = { ...first, id: 'unregistered', start: 31, end: 60 };
    store.commit([service.change(batchPath(first), '## 第2章\n归还旧桨。'), service.change(rhythmPath(first), '## 第2章\n第二章减速。'),
      service.change(batchPath(second), '## 第31章\n渡过冰河。'), service.change(rhythmPath(second), '## 第31章\n第三十一章加速。'),
      service.change(prosePath(1), '上一章拿起木桨。'), service.change(prosePath(30), '冰河开始解冻。')], project);
    const chat = await service.invoke('chat.create', { title: '核对批次' });
    async function send(chapter: number, freeTrial?: true) {
      const id = await service.invoke('chat.send', { conversationId: chat.id, text: '写第' + chapter + '章', manuscript: { ...manuscriptTarget(project.id, prosePath(chapter), ''), freeTrial } });
      for (let i = 0; i < 1000; i++) {
        const reply = await service.invoke('chat.manuscript', { id });
        if (reply.message.status !== 'running') return reply;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      throw new Error('未收到离线回执');
    }
    for (const [chapter, need, skip] of [[31, '渡过冰河。', '归还旧桨。'], [2, '归还旧桨。', '渡过冰河。']] as const) {
      assert.equal((await send(chapter)).message.status, 'complete');
      const wire = wires.at(-1)!;
      assert.ok(wire.system.includes(need) && !wire.system.includes(skip));
      assert.ok(wire.system.includes(chapter === 31 ? '冰河开始解冻。' : '上一章拿起木桨。'));
      assert.deepEqual(JSON.parse(wire.input).batch, chapter === 31 ? [31,60] : [1,30]);
      assert.equal(store.db.project().chapter, 5);
    }
    const directory = path.resolve('.test-output/writing-material-acceptance'); fs.mkdirSync(directory, {recursive: true});
    fs.writeFileSync(path.join(directory, 'desk.json'), JSON.stringify({ projectProgress: store.db.project().chapter,
      requests: wires.map(w => ({ instruction: JSON.parse(w.input), material: JSON.parse(w.system.split('当前任务资料包：').at(-1)!) })) }, null, 2));
    await send(62); assert.equal(wires.length, 2);
    assert.equal((await send(62, true)).message.status, 'complete'); assert.equal(wires.length, 3);
  } finally { await service.drain(); }
});
