import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { characterVoiceSlice } from '../src/core/character-voice';
import { compileContext, contextChanged } from '../src/core/context-compiler';
import { paths, hash } from '../src/core/domain';
import { contextBook, contextCase } from './fixtures/context-book';
import { fakeProfile } from './fixtures/refactor';
import { encodeFacts, rebuildMemory } from '../src/core/memory-records';

const cards = '# 人物卡𠮷\r\n\r\n## 林澈\r\n- 别名：小澈\r\n- 角色编号：CH001\r\n- 说话风格：话到一半会停住，用反问把难题交给对方。\r\n- 做事风格：先摸清价钱再动手。\r\n- 个人秘密：他不是港城人。\r\n- 后期结局：第九卷登上天空城。\r\n\r\n## 渡船老人\r\n- 说话风格：不回答长问题，只报水位和船价。\r\n- 做事风格：先替人系好船绳。\r\n\r\n## 远方旅人\r\n- 说话风格：每句话都提天气。\r\n';

test('人物表达交接按本章姓名、别名或编号选择，逐字保留声音与行为字段', () => {
  for (const name of ['林澈', '小澈', 'CH001']) {
    const slice = characterVoiceSlice(cards, `本章${name}回到码头`)!;
    assert.ok(slice);
    assert.match(slice.content, /话到一半会停住/);
    assert.match(slice.content, /先摸清价钱/);
    assert.doesNotMatch(slice.content, /个人秘密|后期结局|远方旅人|船价/);
    const chars = Array.from(cards);
    assert.equal(slice.content, slice.ranges.map(range => chars.slice(range.start, range.end).join('')).join('\n'));
  }
  assert.equal(characterVoiceSlice(cards, '不涉及任何已登记角色'), undefined);
});

test('人物表达不从代码块、事实块和不完整围栏中读取伪造字段', () => {
  const content = '~~~text\n## 林澈\n- 说话风格：伪造口吻\n~~~\n' + cards + '\n```text\n## 林澈\n- 做事风格：代码中的假行为\n```\n<!-- wenxu-facts:v1 -->\n## 林澈\n- 说话风格：事实块中的假口吻';
  const slice = characterVoiceSlice(content, '林澈')!;
  assert.match(slice.content, /话到一半/);
  assert.doesNotMatch(slice.content, /伪造|假行为|假口吻/);
  assert.equal(characterVoiceSlice('```\n## 林澈\n- 说话风格：伪造口吻', '林澈'), undefined);
});

test('没有表达字段的人物卡不把秘密或整份角色档案当成口吻塞入', () => {
  assert.equal(characterVoiceSlice('## 林澈\n- 隐藏身份：幕后凶手\n- 后期结局：死亡', '林澈'), undefined);
});

function putCards(book: ReturnType<typeof contextBook>) {
  const project = structuredClone(book.project); project.revision++;
  book.store.commit([{ path: paths.roles, content: cards, baseHash: book.store.db.document(paths.roles)!.hash }], project);
  return project;
}

test('S10 补回当前人物表达字段且绑定来源版本，前文修改后不会沿用旧口吻', () => {
  const book = contextBook(false);
  try {
    const project = putCards(book);
    const manifest = compileContext(book.store, project, 'S10', contextCase.request, fakeProfile);
    const voice = manifest.sources.find(source => source.path === paths.roles)!;
    assert.equal(voice.hash, hash(cards)); assert.equal(voice.mode, 'excerpt'); assert.equal(voice.required, true);
    assert.match(voice.content, /话到一半|船价/);
    assert.doesNotMatch(voice.content, /个人秘密|后期结局|远方旅人|事实记录/);
    assert.equal(contextChanged(book.store, manifest), false);
    fs.appendFileSync(path.join(book.root, paths.roles), '\n新的作者口吻设定');
    assert.equal(contextChanged(book.store, manifest), true);
  } finally { book.store.close(); }
});

test('人物限定视角仍遵守原来的资料隔离规则', () => {
  const book = contextBook(true);
  try {
    const project = putCards(book);
    const manifest = compileContext(book.store, project, 'S10', contextCase.request, fakeProfile);
    assert.ok(!manifest.sources.some(source => source.path === paths.roles));
  } finally { book.store.close(); }
});

test('仅读取口吻摘录不会把同一人物库里无关的失效事实扩大成阻断', () => {
  const book = contextBook(false);
  try {
    const bad = structuredClone(book.facts[1]);
    bad.id = 'unrelated-voice-ledger-fact'; bad.subject = '远方旅人'; bad.aliases = []; bad.entityIds = ['traveler'];
    bad.evidence[0].quote = '原文中不存在的远方旅人伤势证据';
    const project = structuredClone(book.project); project.revision++;
    book.store.commit([{ path: paths.roles, content: encodeFacts(cards, [bad]), baseHash: book.store.db.document(paths.roles)!.hash }], project);
    rebuildMemory(book.store);
    const manifest = compileContext(book.store, project, 'S10', contextCase.request, fakeProfile);
    assert.deepEqual(manifest.conflicts, []);
    assert.match(manifest.sources.find(source => source.path === paths.roles)!.content, /话到一半/);
    assert.ok(!JSON.stringify(manifest.sources).includes(bad.id));
    assert.ok(book.store.db.get<string[]>('memoryIssues')!.length > 0, '失效记忆本身仍保留在管理记录中');
  } finally { book.store.close(); }
});
