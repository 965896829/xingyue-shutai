import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tableColumnLayout } from '../src/ui/markdown-tables';

test('dense chapter outlines keep prose readable and short identity columns compact', () => {
  const columns = [
    { heading: '章节', values: ['001', '030'] },
    { heading: '强度', values: ['5', '3'] },
    ...['承接上章', '核心场面', '状态变化', '人物记忆变化'].map(heading => ({ heading, values: ['保留完整的动作、因果与变化，不得省略或截断正文。'.repeat(6)] }))
  ];
  const before = structuredClone(columns), layout = tableColumnLayout(columns);
  assert.ok(layout.stickyFirst);
  assert.ok(layout.widths[0] <= 116 && layout.widths[1] <= 116);
  assert.ok(layout.widths.slice(2).every(width => width >= 224 && width <= 280));
  assert.deepEqual(columns, before, 'layout must not rewrite manuscript content');
});

test('unknown headings, long URLs and unusually long chapter notes stay readable', () => {
  const layout = tableColumnLayout([
    { heading: '章节', values: ['第一章到第三十章：需要保留的补充说明'.repeat(5)] },
    { heading: '自定义字段', values: ['https://example.com/' + 'long-path'.repeat(80)] }
  ]);
  assert.equal(layout.stickyFirst, false, 'wide prose must not consume a frozen pane');
  assert.ok(layout.widths.every(width => width >= 224 && width <= 280));
});

test('small comparison tables and empty tables need no oversized columns', () => {
  const layout = tableColumnLayout([{ heading: '项目', values: ['水桶'] }, { heading: '数量', values: ['12'] }]);
  assert.equal(layout.stickyFirst, false);
  assert.ok(layout.widths.reduce((sum, width) => sum + width, 0) < 400);
  assert.deepEqual(tableColumnLayout([]), { widths: [], stickyFirst: false });
});
