import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SkillRegistry, stageSkills } from '../src/core/skill-registry';
import { creationPolicies, creationPolicy } from '../src/core/creation-policy';
import { systemPrompt } from '../src/core/skill';
import { hash, newProject } from '../src/core/domain';
import { creationPromptResources, titleSystemPrompt, titleEditorialResources } from '../src/core/creation-prompts';
import { AssistantSettings } from '../src/core/assistant-settings';
import { isolatedRoot } from './fixtures/refactor';
import type { TitlePlanning } from '../src/shared/creation';

const root = path.resolve('resources/skill');
const retired = ['runtime/references/agent-guidance.md', 'runtime/references/style-system.md',
  'runtime/references/volume-naming.md', 'references/volume-naming.md',
  'runtime/skills/webnovel-volume-architect/legacy-0.4.71.md',
  'runtime/skills/webnovel-volume-architect/commercial-v2.md',
  'title-editing', 'tags/prompts/title-writer.system.md', 'tags/prompts/title-reviewer.system.md',
  'tags/prompts/writer.system.md'];

test('所有阶段只装入当前专项语义，旧规则文件删除且资源锁与引用完整', () => {
  const registry = new SkillRegistry(root), p = newProject('规则一致性', 'unused', {});
  for (const [stage, id] of Object.entries(stageSkills)) {
    const policy = creationPolicy(root, creationPolicies[id]).content;
    const prompt = systemPrompt(root, p, stage as keyof typeof stageSkills);
    assert.equal(prompt.split(policy).length - 1, 1, stage);
    assert.doesNotMatch(prompt, /创作专项细则|星月书台创作内核 V6|叙述中默认不用|发现一个触发词时/);
  }
  for (const old of retired) assert.equal(fs.existsSync(path.join(root, old)), false, old);
  for (const entry of registry.entries) {
    const raw = registry.read(entry.path);
    for (const match of raw.matchAll(/`(\.\.\/\.\.\/references\/[^`]+\.md)`/g)) {
      const relative = path.posix.normalize(path.posix.join(path.posix.dirname(entry.path), match[1]));
      assert.ok(registry.read(relative).trim(), relative);
    }
  }
  for (const directory of ['runtime', 'design-v7', 'creative-v7', 'tags', 'direction-planning', 'title-market-editing']) {
    const base = path.join(root, directory);
    const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? files(file) : [path.relative(base, file).replaceAll('\\', '/')];
    });
    const lock = JSON.parse(fs.readFileSync(path.join(base, 'resources.lock.json'), 'utf8'));
    assert.deepEqual(Object.keys(lock).sort(), files(base).filter(file => file !== 'resources.lock.json').sort());
    for (const [file, digest] of Object.entries(lock)) assert.equal(hash(fs.readFileSync(path.join(base, file))), digest, file);
  }
});

test('新旧书名合同使用同一番茄规则，旧任务数量、手填和冻结合同保持', () => {
  const resources = creationPromptResources(root), current = titleEditorialResources(root);
  for (const editorialVersion of [undefined, 1, 2] as const) {
    const naming = { editorialVersion, manualTitle: '作者指定的名字', candidateCount: undefined } as TitlePlanning;
    for (const reviewing of [false, true]) {
      const prompt = titleSystemPrompt({ controller: '总控', resources, naming, reviewing,
        submitTool: reviewing ? 'submit_title_review' : 'submit_title_candidates', expression: '' });
      assert.ok(prompt.includes(reviewing ? current.reviewer : current.writer));
      assert.match(prompt, /本批恰好1个候选/);
      assert.match(prompt, /手填模式只核对manualTitle原文，不改名/);
      assert.match(prompt, /没有填写要求不推定偏好短名/);
      assert.doesNotMatch(prompt, /先比较短名、口语句式|先读分析，再比较这些题面/);
    }
    naming.manualTitle = undefined;
    const prompt = titleSystemPrompt({ controller: '总控', resources, naming, reviewing: false,
      submitTool: 'submit_title_candidates', expression: '' });
    assert.match(prompt, /保留旧任务的1至12个候选合同/);
  }
});

test('仅升级系统保存的旧内置默认，作者自定义与明确回退版本均保留', () => {
  const old = `采用成熟长篇作者的结构判断方法，不冒充白金身份或保证商业成绩。
检查长线动力、阶段目标、人物主动选择、对手策略、能力限制与代价是否足以支撑篇幅。成长应改变选择和关系，不只是数字提升。
分卷要有不同任务与核心矛盾。伏笔区分作者计划、正文证据、角色认知与读者可知信息。未解决伤势、物品归属、承诺不能因章节遥远而消失。
提出改动时说明下游影响，不篡改已确认事实。世界观服务冲突和选择，避免设定讲义与名词堆积。长篇不等于拖沓，细节密度依题材和作者目标调整。
可比较不同路线的收益和代价，不把起点固定等同于某一种文风；判断依据来自本书资料。`;
  assert.equal(hash(old).slice(0, 16), 'fda6f74c53aeece7');
  const directory = isolatedRoot('prompt-default-migration');
  const settings = new AssistantSettings(directory);
  settings.saveRole('qidian', old, '恢复默认');
  const role = settings.roles().find(role => role.id === 'qidian')!;
  const prior = role.history.find(item => item.text === old)!;
  assert.ok(prior);
  assert.match(role.current.text, /无代价能力/);
  assert.match(new AssistantSettings(directory).roles().find(role => role.id === 'qidian')!.current.text, /无代价能力/);
  settings.saveRole('qidian', old);
  assert.equal(settings.roles().find(role => role.id === 'qidian')!.current.text, old);
  settings.reset('qidian');
  settings.rollback('qidian', prior.id);
  assert.equal(new AssistantSettings(directory).roles().find(role => role.id === 'qidian')!.current.text, old);
});
