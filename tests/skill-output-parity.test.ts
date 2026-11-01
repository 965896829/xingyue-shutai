import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { newProject, hash, stageOutputs } from '../src/core/domain';
import { systemPrompt } from '../src/core/skill';
import { SkillRegistry, stageSkills } from '../src/core/skill-registry';
import type { StageId } from '../src/shared/types';

const root = path.resolve('resources/skill');
const normalize = (text: string) => text.replaceAll('\r\n', '\n').trim();
const markdownBlocks = (text: string) => [...text.matchAll(/```markdown\r?\n([\s\S]*?)\r?\n```/g)]
  .map(match => normalize(match[1]));
const project = () => newProject('大逃杀：杀我之前，请出示死亡权', 'unused', {
  targetWords: 2_000_000, chapterWords: 2500, minWords: 2300, maxWords: 2700,
  genre: '都市悬疑', constraints: '顾平安是事故调查员；保留死亡权规则与七年前悬念。'
});

test('客户端运行时模板保留原 Skill 的完整内容，未增加机器附表或改变字段', () => {
  const canonical = markdownBlocks(fs.readFileSync(path.join(root, 'references/templates.md'), 'utf8'));
  const templateRoot = path.join(root, 'runtime/references/templates');
  let checked = 0;
  for (const file of fs.readdirSync(templateRoot).filter(file => file.endsWith('.md'))) {
    for (const block of markdownBlocks(fs.readFileSync(path.join(templateRoot, file), 'utf8'))) {
      assert.ok(canonical.includes(block), `${file} 的模板与原 Skill 不一致`);
      checked++;
    }
  }
  assert.equal(checked, canonical.length, '实际检查全部原阶段模板，不能遗漏模板');
  assert.ok(checked > 0, '不能以空目录通过');
});

test('S01 与 S05—S09 加载各自原模板并保留作者已定输入', () => {
  const expected: [StageId, string[]][] = [
    ['S01', ['设定拆解模板.md']],
    ['S05', ['分卷大纲模板.md']],
    ['S06', ['章节总纲模板.md']],
    ['S07', ['三十章节奏模板.md']],
    ['S08', ['三十章批量细纲模板.md']],
    ['S09', ['章节任务清单模板.md', '章节细纲模板.md']]
  ];
  for (const [stage, files] of expected) {
    const prompt = normalize(systemPrompt(root, project(), stage));
    for (const file of files) {
      const blocks = markdownBlocks(fs.readFileSync(path.join(root, 'runtime/references/templates', file), 'utf8'));
      assert.ok(blocks.length > 0);
      for (const block of blocks) assert.ok(prompt.includes(block), `${stage} 缺少 ${file} 完整结构`);
    }
    assert.match(prompt, /顾平安是事故调查员/);
    assert.match(prompt, /原始设定、已定书名、篇幅与作者硬约束优先/);
    assert.doesNotMatch(prompt, /承诺追踪、成本和来源说明另列附表/);
  }
});

test('输出去重保留完整批次与可执行场面，不把内部证据搬入创作文件', () => {
  const registry = new SkillRegistry(root);
  const batch = registry.load(stageSkills.S08).content;
  assert.match(batch, /默认完整30章/);
  assert.match(batch, /逐章写完整十二字段/);
  assert.match(batch, /通常三场的可执行推进，按内容需要增减/);
  assert.match(batch, /场所、参与者、信息依据、行动或对话、选择代价和结果/);
  assert.match(batch, /不能.*省略章节|不要.*省略章节/);
  assert.match(batch, /工具要求的 baseHash、独立质量审阅证据、结构化记忆来源仍须准确提交/);
  const rhythm = registry.load(stageSkills.S07).content;
  assert.match(rhythm, /每行一个3—5章单元/);
  assert.match(rhythm, /完整覆盖当前范围/);
  assert.match(rhythm, /确有重复风险或有意例外/);
  const world = registry.load(stageSkills.S03).content;
  assert.match(world, /边界、代价、谁知道/);
  assert.doesNotMatch(world, /--- references\/templates\/连续性台账模板.md ---/);
});

test('S01 读者承诺留在十二字段，真实风险不被结构约束删除', () => {
  const prompt = systemPrompt(root, project(), 'S01');
  assert.match(prompt, /连续完成原模板十二字段/);
  assert.match(prompt, /读者承诺直接落实在原十二字段/);
  assert.match(prompt, /不另建小节或文件/);
  assert.match(prompt, /本轮完整原始输入已经随上下文提供并单独存档/);
  assert.match(prompt, /不写场面分镜、前三章详案或首批三十章计划/);
  assert.match(prompt, /完整规则、势力细案、后期真相与分卷安排留给S03、S05/);
  for (const issue of ['规则禁则与退出条件冲突', '主角异常与通常退出路径', '转移的生效', '反作用及其结果归属', '强迫与自主选择的责任', '前期公开与后期保密', '分卷边界衔接'])
    assert.ok(prompt.includes(issue), `保留实际存在的逻辑接口：${issue}`);
  assert.match(prompt, /其他关键矛盾也不能省略/);
  assert.match(prompt, /必要因果和作者硬约束优先，不因篇幅建议删掉实际风险/);
  assert.match(prompt, /不增加硬性短字数门槛/);
  assert.doesNotMatch(prompt, /已授权的S01[^\n]*；第1章，批次/);
});

test('S03 实际提示保留八栏目，同时把规则去重与退出责任闭合交给专项', () => {
  const prompt = systemPrompt(root, project(), 'S03');
  for (const field of ['世界底层规则', '主角金手指', '金手指限制', '使用代价', '信息差', '敌人反制方式', '体系升级空间', '中后期防重复机制'])
    assert.ok(prompt.includes(field), `S03 不能因去重丢失原栏目：${field}`);
  assert.match(prompt, /紧凑规则表或短条目/);
  assert.match(prompt, /不要求每条机械展开六个子段/);
  assert.match(prompt, /其余栏目引用规则编号，只补本栏独有/);
  assert.match(prompt, /保管默认等同权属转移/);
  assert.match(prompt, /仍有效的他人权益由谁承接/);
  assert.match(prompt, /权利人通过什么可执行路径取回或主张/);
  assert.match(prompt, /不是硬性上限，也不要求凑足下限/);
  assert.match(prompt, /必要因果、唯一成立条件、作者硬约束和有用判例优先/);
  assert.doesNotMatch(prompt, /返还者必须|自赎者必须|00000.*必须/);
});

test('S04 分轮提交完整自然文件，九份产物与角色十九字段均保留', () => {
  const state = project();
  const prompt = systemPrompt(root, state, 'S04');
  const specialist = new SkillRegistry(root).read('skills/webnovel-character-engine/SKILL.md');
  assert.equal(stageOutputs('S04', state).length, 9);
  for (const file of stageOutputs('S04', state)) assert.ok(specialist.includes(file), `分组不能遗漏 ${file}`);
  for (const field of ['重要度', '剧情功能', '首次出场', '当前身份', '所属阵营', '外显人设', '深层欲望', '当前目标', '最大恐惧', '做事风格', '说话风格', '情绪底色', '当前心情', '心情来源', '对主角态度', '秘密', '弱点', '爽点用途', '后续可用冲突'])
    assert.ok(prompt.includes(`- ${field}：`), `保留原角色字段：${field}`);
  assert.match(prompt, /按内容长度决定分组，不固定每轮文件数量/);
  assert.match(prompt, /完整文件内容合计约8000字符以内可合为一次提交/);
  assert.match(prompt, /收到真实保存回执后再接下一组/);
  assert.match(prompt, /candidate:true/);
  assert.match(prompt, /已保存且无实际问题的文件不重复生成或重发/);
  assert.match(prompt, /不宣称阶段完成/);
  assert.match(prompt, /不虚构经历来填满模板/);
  assert.doesNotMatch(specialist, /append:true|draftHash|final:false/);
});

test('S06 与 S08 默认按完整章节分响应保存，保留质量与完整覆盖要求', () => {
  const registry = new SkillRegistry(root);
  for (const stage of ['S06', 'S08'] as const) {
    const prompt = systemPrompt(root, project(), stage);
    assert.match(prompt, stage === 'S06' ? /通常约15章/ : /通常约8—10章/);
    assert.match(prompt, /单段不超过8000字符并留有余量，不设固定章数上限/);
    assert.doesNotMatch(prompt, /每次模型响应最多提交(?:5|10)章/);
    assert.match(prompt, /append:true/);
    assert.match(prompt, /首段 `draftHash:null`/);
    assert.match(prompt, /上次真实保存回执中的 `draftHash`/);
    assert.match(prompt, /收到真实保存回执后再生成下一段/);
    assert.match(prompt, /中间段 `final:false`/);
    assert.match(prompt, /最后一段核对当前批次全部章号/);
    assert.match(prompt, /才 `final:true`/);
    assert.match(prompt, /不在同一响应内先生成后续几段/);
    assert.match(prompt, /不为确认同一内容再普通读取/);
    assert.match(prompt, /已保存且无实际问题/);
  }
  const roadmap = registry.read('skills/webnovel-chapter-roadmap/SKILL.md');
  assert.match(roadmap, /每章保留原十三列及具体因果/);
  assert.match(roadmap, /只有首段写文件标题、必要批次说明和十三列表头/);
  assert.match(roadmap, /不会自动复制正式文档/);
  assert.match(roadmap, /不能只交新批次便覆盖删除旧批次/);
  const batch = registry.read('skills/webnovel-batch-outline/SKILL.md');
  assert.match(batch, /每章保留原十二字段和可执行场面/);
  assert.match(batch, /通常三场仍须写清人物、场所、信息依据、行动选择、代价与结果/);
  assert.match(batch, /不能为凑章数删场/);
  assert.match(batch, /只有首段写文件标题和一次完整批次字段/);
  assert.match(batch, /默认30章必须全部覆盖/);
});

test('更新后的专项提示与共享契约保持完整性锁，不改变读写权限', () => {
  const registry = new SkillRegistry(root);
  for (const [file, digest] of Object.entries(registry.lock))
    assert.equal(hash(fs.readFileSync(path.join(root, 'runtime', file))), digest, file);
  for (const entry of registry.entries) {
    const loaded = registry.load(entry.id);
    assert.equal(hash(registry.read(entry.path)), entry.sha256, entry.id);
    assert.ok(loaded.content.length > 0);
  }
});

test('设计阶段承担必要决策，后续审稿使用宿主采纳记录且保留真实冲突检查', () => {
  const registry = new SkillRegistry(root);
  const world = registry.load(stageSkills.S03).content;
  assert.match(world, /选择一个可执行方案随本阶段整体审阅/);
  assert.match(world, /不能把整套机制全部悬置/);
  const review = registry.load('webnovel-chapter-reviewer').content;
  assert.match(review, /authorization.accepted_stages 与当前来源版本/);
  assert.match(review, /尚未选择的互斥方案、条件未满足或真实规则冲突仍须指出/);
  assert.match(review, /不要求作者补内部确认记录/);
  assert.match(review, /模型始终无权自我批准/);
  assert.match(registry.controller().content, /正式采纳后的版本状态以宿主记录为准/);
});

test('S01、S02、S05 不把上游建议升级为作者约束，事件卷属先于平均分卷', () => {
  const registry = new SkillRegistry(root);
  assert.match(registry.load(stageSkills.S01).content, /保留指定事件所属卷及时点/);
  assert.match(registry.load(stageSkills.S01).content, /不能凭惯常卷长制造矛盾/);
  const config = registry.load(stageSkills.S02).content;
  assert.match(config, /“用户硬约束”从 authorPremise 及作者明确后续指令提取/);
  assert.match(config, /不能代替原文或把相反建议写成作者要求/);
  assert.match(registry.load(stageSkills.S05).content, /允许不等长分卷/);
  assert.match(registry.load(stageSkills.S05).content, /保留原文的具体事件承诺/);
});
