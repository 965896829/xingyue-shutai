import path from 'node:path';
import { FileStore } from '../../src/core/storage';
import { newProject, paths, taskPath, detailPath, prosePath, batchPath, activeBatch, hash } from '../../src/core/domain';
import { initialFiles } from '../../src/core/skill';
import { encodeFacts, rebuildMemory } from '../../src/core/memory';
import { factSchema, type Fact } from '../../src/shared/types';
import { isolatedRoot, fakeProfile } from './refactor';

export const contextCase = {
  request: '续写第25章，小澈到码头寻找玉钥，承接上一章。',
  rule: '林澈在第30章前不能使用瞬移，也不能借他人能力绕过这条限制。',
  secret: '玉钥保管者实际是林澈的师父，此事只能在第31章揭示。',
  injury: '林澈右臂仍然骨折，尚未接受治疗。',
  promise: '林澈答应在第26章之前把玉钥交还给渡船老人。'
};

export function contextBook(character = true) {
  const root = isolatedRoot('context-book'), store = new FileStore(root);
  const project = newProject('上下文编排合成验收', root, { defaultProfileId: fakeProfile.id, viewpointCharacterId: character ? 'linche' : '', chapterWords: 500, minWords: 100, maxWords: 1000 });
  project.stage = 'S10'; project.chapter = 25; project.revision = 1; project.chapters = { 1: 'complete', 24: 'complete' };
  const files = initialFiles(project, path.resolve('resources/skill'), '林澈在港城寻找失落玉钥。');
  files[paths.seed] = '# 作者设定\n\n林澈在港城寻找失落玉钥。';
  files[paths.world] = `# 世界规则\n\n${contextCase.rule}\n\n${contextCase.secret}`;
  files[paths.style] = '# 文风\n\n动作清晰，人物主动选择。';
  files[paths.volumes] = '# 分卷目标\n\n全局约定：不跳过能力代价。\n\n| 卷 | 章节范围 | 目标 |\n| --- | --- | --- |\n| 一 | 1—30 | 找回玉钥 |\n| 二 | 31—60 | 登上天空城 |';
  files[paths.outline] = '# 章节总纲\n\n- 全局禁区：不能让人物无依据知道秘密。\n\n| 章次 | 任务 |\n| --- | --- |\n| 第24章 | 抵达渡口 |\n| 第25章 | 码头寻找玉钥 |\n| 第26章 | 后续规划不应常驻 |';
  files[batchPath(activeBatch(project))] = '# 批次细纲\n\n- 本批禁止提前揭示：玉钥保管者身份。\n\n## 第24章\n\n走出旧城。\n\n## 第25章\n\n林澈在码头主动追问渡船老人，保护右臂。\n\n### 允许揭示\n\n只揭示玉钥最后出现地点。\n\n## 第26章\n\n后续章节独有的秘密暗号赤鸢。';
  files[taskPath(25)] = '# 本章任务\n\n- 主角：林澈（小澈）\n- 任务：寻找玉钥\n- 禁止提前揭示：保管者身份\n- 本章允许揭示：渡船曾停靠西岸。';
  files[detailPath(25)] = '# 第25章细纲\n\n林澈走到码头，向渡船老人询问玉钥。';
  files[prosePath(1)] = `# 第一章\n\n${contextCase.promise}`;
  files[prosePath(24)] = '# 第二十四章\n\n' + '过去的风雨已经远去，城里行人来来往往。\n\n'.repeat(400) + contextCase.injury + '\n\n林澈站在码头入口，左手握住栏杆。';
  const fact = (values: Partial<Fact> & Pick<Fact, 'id' | 'predicate' | 'value'>) => factSchema.parse({
    subject: '林澈', aliases: ['小澈'], entityIds: ['linche'], kind: 'event', category: 'knowledge', state: 'active', reviewStatus: 'accepted',
    fromChapter: 1, revealedAt: 1, scope: 'entity', evidence: [{ path: prosePath(24), hash: hash(files[prosePath(24)]), quote: contextCase.injury }], ...values
  });
  const facts = [
    fact({ id: 'ability-ban', predicate: '能力限制', value: '第30章前不能瞬移', kind: 'author_constraint', category: 'term', mandatory: true, toChapter: 29,
      evidence: [{ path: paths.world, hash: hash(files[paths.world]), quote: contextCase.rule }] }),
    fact({ id: 'arm', predicate: '右臂状态', value: '骨折，尚未治疗', category: 'injury', mandatory: true, fromChapter: 24, revealedAt: 24,
      knowledge: [{ who: 'linche', mode: 'seen', fromChapter: 24 }] }),
    fact({ id: 'key-secret', predicate: '玉钥保管者', value: '林澈的师父', kind: 'world_rule', revealedAt: 31, mandatory: false,
      evidence: [{ path: paths.world, hash: hash(files[paths.world]), quote: contextCase.secret }] }),
    fact({ id: 'key-promise', predicate: '未完成承诺', value: '第26章前向渡船老人归还玉钥', category: 'promise', mandatory: true,
      knowledge: [{ who: 'linche', mode: 'told', fromChapter: 1 }], evidence: [{ path: prosePath(1), hash: hash(files[prosePath(1)]), quote: contextCase.promise }] }),
    fact({ id: 'alternate-arm', predicate: '右臂状态', value: '已经痊愈', worldId: 'other' }),
    fact({ id: 'old-arm', predicate: '右臂状态', value: '早年无伤', state: 'superseded' })
  ];
  files[paths.items] = encodeFacts('# 验收事实记录', facts);
  store.commit(Object.entries(files).map(([path, content]) => ({ path, content, baseHash: null })), project);
  rebuildMemory(store);
  return { store, project, root, facts, files };
}
