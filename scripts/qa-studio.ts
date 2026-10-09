import fs from 'node:fs';
import path from 'node:path';
import { Service } from '../src/core/service';
import {
  paths,
  prosePath,
  detailPath,
  batchPath,
  activeBatch,
  hash,
  id,
  now,
  stageOutputs
} from '../src/core/domain';
import { fixture } from '../tests/fixtures/workflow';
import { encodeFacts } from '../src/core/memory';
import { factSchema } from '../src/shared/types';
const directory = path.resolve('.test-output/studio-qa-' + Date.now());
fs.mkdirSync(directory, { recursive: true });
const service = new Service(path.resolve('resources/skill'), () => {});
await service.invoke('project.create', {
  parent: directory,
  title: '雾城来信 · 验收样本',
  premise: '阿宁在雾城寻找失踪的师父。',
  config: { chapterWords: 200, minWords: 150, maxWords: 400, targetWords: 6000, batchSize: 30 }
});
const s = service.store!,
  p = s.db.project();
p.chapter = 3;
p.stage = 'S10';
p.revision++;
p.chapters = { 1: 'complete', 2: 'complete' };
const prepared = new Map<string, string>();
for (const stage of ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07', 'S08', 'S09'] as const)
  for (const file of stageOutputs(stage, p)) prepared.set(file, fixture(p, file, service));
s.commit(
  [...prepared].map(([path, content]) => ({ path, content, baseHash: s.db.document(path)?.hash ?? null })),
  p
);
p.revision++;
const first =
  '# 第001章 雾中的信\n\n阿宁左手的伤还没有好，玉钥仍系在腰间。城门外传来第三遍钟声。\n\n师父留下一封信，约他三日后在山门相见。阿宁不知信是谁送来的。';
const second =
  '# 第002章 夜渡\n\n阿宁将药交给渡船上的阿甲。他答应在天亮前回来。\n\n阿甲看着那枚玉钥，决定把船再等一夜。';
const facts = [
  factSchema.parse({
    id: 'injury',
    subject: '阿宁',
    entityIds: ['ning'],
    aliases: ['小宁'],
    predicate: '左手',
    value: '伤势未愈',
    kind: 'event',
    category: 'injury',
    mandatory: true,
    fromChapter: 1,
    revealedAt: 1,
    reviewStatus: 'accepted',
    knowledge: [{ who: 'ning', mode: 'seen', fromChapter: 1 }],
    evidence: [{ path: prosePath(1), hash: hash(first), quote: '阿宁左手的伤还没有好，玉钥仍系在腰间。' }]
  }),
  factSchema.parse({
    id: 'key',
    subject: '阿宁',
    entityIds: ['ning'],
    predicate: '玉钥',
    value: '随身携带',
    kind: 'event',
    category: 'item',
    fromChapter: 1,
    revealedAt: 1,
    reviewStatus: 'accepted',
    evidence: [{ path: prosePath(1), hash: hash(first), quote: '玉钥仍系在腰间。' }]
  }),
  factSchema.parse({
    id: 'promise',
    subject: '阿宁',
    entityIds: ['ning'],
    predicate: '山门之约',
    value: '三日后与师父相见',
    kind: 'event',
    category: 'promise',
    mandatory: true,
    fromChapter: 1,
    revealedAt: 1,
    reviewStatus: 'accepted',
    evidence: [{ path: prosePath(1), hash: hash(first), quote: '师父留下一封信，约他三日后在山门相见。' }]
  }),
  factSchema.parse({
    id: 'boat',
    subject: '阿甲',
    entityIds: ['jia'],
    predicate: '渡船',
    value: '再等一夜',
    kind: 'event',
    category: 'character',
    fromChapter: 2,
    revealedAt: 2,
    reviewStatus: 'accepted',
    evidence: [{ path: prosePath(2), hash: hash(second), quote: '阿甲看着那枚玉钥，决定把船再等一夜。' }]
  })
];
const plan = fixture(p, detailPath(3), service);
const changes = [
  { path: prosePath(1), content: first },
  { path: prosePath(2), content: second },
  { path: detailPath(3), content: plan },
  {
    path: batchPath(activeBatch(p)),
    content: fixture(p, batchPath(activeBatch(p)), service)
  },
  { path: paths.items, content: encodeFacts(s.read(paths.items).content, facts) }
].map((c) => ({ ...c, baseHash: s.db.document(c.path)?.hash ?? null }));
s.commit(changes, p);
const head = s.db.head()!;
for (const chapter of [1, 2, 3])
  for (const track of ['plan', 'accepted', 'candidate']) {
    if (chapter === 3 && track === 'accepted') continue;
    if (chapter < 3 && track === 'candidate') continue;
    const text = chapter === 1 ? first : chapter === 2 ? second : plan,
      file = chapter === 3 ? detailPath(3) : prosePath(chapter),
      quote = text.split('\n\n')[1];
    const assessment = {
      id: id(),
      projectId: p.id,
      snapshotId: head.id,
      draftId: 'qa',
      draftVersion: 1,
      hash: hash(text),
      epoch: 'qa',
      chapter,
      track,
      rubric: 'narrative-1',
      createdAt: now(),
      profileId: 'qa',
      values: {
        pressure: chapter === 1 ? 4 : chapter === 2 ? 2 : 3,
        payoff: chapter === 2 ? 3 : null,
        emotion: 3,
        revelation: chapter === 1 ? 3 : 1,
        relationship: chapter === 2 ? 4 : 2
      },
      evidence: [{ path: file, hash: hash(text), quote }],
      note: '验收样本：依据片段评估。',
      usage: { input: 0, output: 0, cost: 0, currency: 'USD' }
    };
    s.db.sql.prepare('INSERT INTO assessments VALUES(?,?)').run(assessment.id, JSON.stringify(assessment));
  }
service.close();
const data = path.join(directory, 'userdata');
fs.mkdirSync(data);
fs.writeFileSync(
  path.join(data, 'settings.json'),
  JSON.stringify({ profiles: [], recent: [{ title: p.title, root: p.root }] })
);
fs.writeFileSync(
  '.test-output/studio-qa-current.json',
  JSON.stringify({ directory, data, root: p.root }, null, 2)
);
console.log({ directory, data, root: p.root });
