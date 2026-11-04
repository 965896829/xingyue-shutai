import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { refactorFixture } from '../tests/fixtures/refactor';
import { factSchema } from '../src/shared/types';
import { factReadDependency, factReadSetChanged } from '../src/core/runtime/fact-read-set';
import { revisionMaterials } from '../src/core/workflows/revision-core';
import { paths, prosePath } from '../src/core/domain';

const { store, run } = refactorFixture();
const output = path.resolve('.test-output/audit-0497/scale.json');
try {
  const scope = { worldId: 'main', timelineId: 'main' };
  const base = factSchema.parse({ id: 'identity', kind: 'state', category: 'character', subject: '陆川', entityIds: ['lu'], predicate: '职业', value: '调查员', reviewStatus: 'accepted', fromChapter: 1, revealedAt: 1,
    evidence: [{ path: '正文.md', hash: store.db.document('正文.md')!.hash, quote: '原稿' }] });
  const rows: object[] = [];
  const names = Array.from({ length: 500 }, (_, index) => `配角【${String(index).padStart(3, '0')}】`);
  store.commit([{ path: paths.roles, baseHash: null, content: '# 角色卡\n\n' + names.map((name, index) =>
    `## ${name}\n\n- 标识：person-${index}\n- 当前身份：交接参与者\n- 当前目标：核验交接记录\n- 做事风格：按实际依据行动\n`).join('\n') }], store.db.project());
  for (const count of [1000, 10000, 50000]) {
    const facts = [base, ...Array.from({ length: count - 1 }, (_, index) => ({ ...base, id: `record-${index}`, subject: names[index % 500], entityIds: [`person-${index % 500}`], predicate: `状态${index % 100}`, value: `第${index}次交接记录`, fromChapter: 1 + index % 1200 }))];
    const saveAt = performance.now(); store.db.replaceFacts(facts, store.db.project().revision); const saveMs = performance.now() - saveAt;
    const selection = { query: '陆川核对通行证', entityIds: ['lu'], chapter: 600 };
    const beforeAll = performance.now(), all = store.db.facts(scope), fullMs = performance.now() - beforeAll;
    const beforeQuery = performance.now(), selected = store.db.factsForTask(scope, selection), queryMs = performance.now() - beforeQuery;
    assert.equal(all.length, count); assert.deepEqual(selected.map(fact => fact.id), ['identity']);
    const dependency = factReadDependency(selected, scope, selection);
    const beforeValidation = performance.now(); assert.equal(factReadSetChanged(store, dependency), false); const validationMs = performance.now() - beforeValidation;
    const entityIds = Array.from({ length: 50 }, (_, index) => `person-${index}`);
    const denseAt = performance.now();
    const dense = store.db.factsForTask(scope, { query: '核验', entityIds, chapter: 600 });
    const denseMs = performance.now() - denseAt;
    assert.deepEqual(dense.map(fact => fact.id), facts.filter(fact => fact.fromChapter <= 600 && fact.entityIds.some(id => entityIds.includes(id))).map(fact => fact.id));
    const revised = { ...run, chapter: 600, changes: [{ path: prosePath(600), baseHash: null,
      content: '# 第600章 核验\n\n' + names.slice(0, 50).join('、') + '共同核验交接记录。'.repeat(250) }] };
    const revisionAt = performance.now(), material = revisionMaterials(store, revised, 600), revisionMs = performance.now() - revisionAt;
    assert.equal(material.characters.length, 50);
    assert.ok(material.documents.some(document => document.path === paths.roles));
    rows.push({ count, saveMs, fullMs, queryMs, validationMs, parsedCandidates: selected.length, baselineParsedFacts: all.length,
      selectedBytes: Buffer.byteLength(JSON.stringify(selected)), baselineBytes: Buffer.byteLength(JSON.stringify(all)),
      denseEntities: entityIds.length, denseCandidates: dense.length, denseMs,
      revision: { characters: material.characters.length, facts: material.facts.length, documents: material.documents.length,
        bytes: Buffer.byteLength(JSON.stringify(material)), elapsedMs: revisionMs } });
  }
  fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, JSON.stringify({ fixture: '500人物、1200章位置、多状态记录；单人物、50人物及真实修订材料编译路径，本机SQLite，非百万字作品质量评价',
    limitation: '宽泛主题可能召回大量历史资料；完整台账不会伪装为摘要替换，超出窗口仍由网关拒发。', rows }, null, 2));
  console.log(JSON.stringify(rows));
} finally { store.close(); }
