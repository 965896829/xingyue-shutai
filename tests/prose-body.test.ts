import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { countWords, hash, newProject } from '../src/core/domain';
import { extractProseBody } from '../src/core/prose-body';
import { checkProse } from '../src/core/manuscript-check';

const file = '07_正文章节/第001章.md';
const config = { ...newProject('计数边界', 'unused', {}).config, minWords: 2300, maxWords: 2700 };
const body = (length: number) => '甲乙丙丁戊己庚辛壬癸'.repeat(Math.ceil(length / 10)).slice(0, length);

test('明确的首行章名与原一级标题共用 Unicode 正文口径', () => {
  for (const heading of ['第001章 刀落在谁身上', '第一章 刀落在谁身上', '第一百零一回 刀落在谁身上', '第００１章　刀落在谁身上', '第001章', '# 第001章 刀落在谁身上', '#章名']) {
    for (const separator of ['\n', '\r\n']) {
      const text = `\uFEFF\r\n \t${heading}${separator}\n你 好\t𠮷😀`;
      assert.equal(countWords(text), 4, heading);
      assert.equal(extractProseBody(text).replace(/\s/gu, ''), '你好𠮷😀', heading);
    }
  }
});

test('无标题、叙事句、对话和后续小节不会被推断成首标题', () => {
  for (const text of [
    '第一章是他最不愿回忆的一夜。\n\n他关上门。',
    '第一章开始时，他仍在车站。\n下一句。',
    '第一章 开始时，他仍在车站。\n下一句。',
    '第一章 他关上门。\n下一句。',
    '“第一章 刀落在谁身上？”他问。\n下一句。',
    '第一章 “把东西给我”\n下一句。',
    '普通首段。\n\n# 第001章\n正文',
    '## 夜晚\n他关上门。',
    '# 第001章\n正文\n\n## 第二场\n后文'
  ]) {
    const expected = text.startsWith('# 第001章\n') ? text.slice('# 第001章\n'.length) : text;
    assert.equal(extractProseBody(text), expected);
    assert.equal(countWords(text), Array.from(expected.replace(/\s/gu, '')).length);
  }
});

test('真实请求056普通首标题和规范标题均为2424个正文码点', () => {
  // Preserved completed model output; no live project or request log is needed by the test.
  const original = fs.readFileSync(new URL('./fixtures/chapter-056-prose.md', import.meta.url), 'utf8');
  assert.equal(hash(original), 'a0096b97a5e871ad04352482e828dc06e80725217036c25e4617724b922dc3c5');
  assert.equal(Array.from(original.replace(/\s/gu, '')).length, 2435);
  assert.equal(countWords(original), 2424);
  assert.equal(countWords(`# ${original}`), 2424);
  assert.ok(!checkProse(file, original, config).some(issue => issue.code === 'word_count'));
});

test('正文篇幅严格检查2300与2700边界，不借标题凑字或误伤上限', () => {
  for (const heading of ['第001章 刀落在谁身上', '# 第001章 刀落在谁身上']) {
    for (const length of [2299, 2300, 2700, 2701]) {
      const text = `${heading}\n\n${body(length)}`;
      assert.equal(countWords(text), length);
      assert.equal(checkProse(file, text, config).some(issue => issue.code === 'word_count'), length < 2300 || length > 2700);
    }
  }
});

test('普通章标题不会遮蔽空稿与占位正文检查', () => {
  for (const text of ['第001章 刀落在谁身上', '第001章\r\n\r\n', '第001章 刀落在谁身上\n\n待填写']) {
    assert.ok(checkProse(file, text, config).some(issue => issue.code === 'prose_placeholder'), text);
  }
});
