import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  loadNamingRules,
  parseNamingRules,
  namingPrompt,
  selectNamingModules,
  readNamingModules
} from '../src/core/naming';
import { systemPrompt, templates } from '../src/core/skill';
import { newProject, paths } from '../src/core/domain';
import { Service } from '../src/core/service';
import { profileSchema, type ModelResult, type ToolCall } from '../src/shared/types';
import type { Caller } from '../src/core/runner';

const skill = path.resolve('resources/skill');
const source = () => fs.readFileSync(path.join(skill, 'references/naming-system.md'), 'utf8');
const moduleIds = (genre: string) =>
  selectNamingModules(loadNamingRules(skill), genre).modules.map((m) => m.id);
const copySkill = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-naming-skill-'));
  fs.cpSync(skill, root, { recursive: true });
  return root;
};

test('完整命名规则按需加载，保留所有通用约束且不把全部题材和验收故事塞入提示', () => {
  const rules = loadNamingRules(skill);
  assert.equal(rules.modules.length, 49);
  const prompt = namingPrompt(rules, '脑洞玄幻');
  assert.ok(prompt.includes(rules.core));
  for (const m of rules.modules) {
    assert.ok(prompt.includes(`${m.id}：${m.title}`));
    assert.equal(prompt.includes(m.content), m.id === 'G08');
  }
  assert.doesNotMatch(prompt, /^## 十一、/m);
  assert.ok(Buffer.byteLength(prompt) < Buffer.byteLength(source()) * 0.8);
});

test('混合题材组合预载，未知、否定与歧义标签不被偷偷映射成玄幻或性别组合', () => {
  assert.deepEqual(moduleIds('都市脑洞＋规则怪谈'), ['G02', 'T01']);
  assert.deepEqual(moduleIds('双男主＋东方仙侠'), ['G09', 'G35']);
  assert.deepEqual(moduleIds('古言脑洞＋穿书＋种田'), ['G29', 'G33', 'T03']);
  assert.deepEqual(moduleIds('快穿＋年代＋悬疑'), ['G32', 'G34', 'G37']);
  for (const genre of ['', '新题材', '不要东方仙侠', '纯爱', '奇幻仙侠', '悬疑恋爱'])
    assert.deepEqual(moduleIds(genre), ['G37'], genre);
  assert.deepEqual(moduleIds('医术'), ['T07']);
  assert.deepEqual(moduleIds('都市日常＋未知分类'), ['G01', 'G37']);
});

test('按需工具只读取索引内模块，去重并拒绝任意路径、过量和空请求', () => {
  const rules = loadNamingRules(skill);
  const result = readNamingModules(skill, ['G04', 'T01', 'G04'], rules.hash);
  assert.deepEqual(
    result.modules.map((m) => m.id),
    ['G04', 'T01']
  );
  for (const m of result.modules)
    assert.deepEqual(
      m,
      rules.modules.find((x) => x.id === m.id)
    );
  for (const ids of [[], ['../../settings.json'], ['G99'], Array(9).fill('G01')])
    assert.throws(() => readNamingModules(skill, ids, rules.hash));
  assert.throws(() => readNamingModules(skill, ['G01'], 'stale'), /已改变/);
});

test('规则文件版本、通用章节、题材正文或模块损坏时明确报错', () => {
  const text = source();
  const m = loadNamingRules(skill).modules.find((m) => m.id === 'G03')!;
  for (const invalid of [
    text.replace('版本：v2.0', '版本：v9.0'),
    text.replace('## 二、', '## 删除、'),
    text.replace(m.content, ''),
    text.replace('### G03 ', '### G02 '),
    text.replace(m.content, '### G03 都市高武\n')
  ])
    assert.throws(() => parseNamingRules(invalid));
});

test('未预载模块的修改也改变任务规则哈希，避免恢复时混用规则版本', () => {
  const p = newProject('规则版本', 'unused', { genre: '都市日常' });
  const before = loadNamingRules(skill);
  const after = parseNamingRules(source().replace('### G31 玄幻言情', '### G31 玄幻言情\n\n新增命名约束。'));
  assert.notEqual(before.hash, after.hash);
  assert.notEqual(systemPrompt(skill, p, 'S01', before), systemPrompt(skill, p, 'S01', after));
  assert.ok(!namingPrompt(after, p.config.genre).includes('新增命名约束。'));
});

function response(calls: ToolCall[] = []): ModelResult {
  return {
    text: '测试回执',
    calls,
    native: { role: 'assistant', content: '测试回执' },
    usage: { input: 1, output: 1, cost: 0, currency: 'USD' },
    stop: calls.length ? 'tools' : 'complete'
  };
}
async function setup(caller: Caller, rulesRoot = skill) {
  const service = new Service(rulesRoot, () => {}, caller);
  service.profiles = [
    {
      ...profileSchema.parse({
        id: 'mock',
        name: 'mock',
        protocol: 'chat',
        model: 'mock',
        baseUrl: 'http://127.0.0.1:1/v1',
        stream: false,
        contextLimit: 1000000
      }),
      apiKey: 'fixture'
    }
  ];
  await service.invoke('project.create', {
    parent: fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-naming-')),
    title: '命名测试',
    premise: '已确认的现代医院与古老宗门并存',
    config: { genre: '都市日常' }
  });
  return service;
}
async function start(service: Service) {
  const id = await service.invoke('run.start', { request: '生成当前阶段候选', profileId: 'mock' });
  while (service.runner!.controller) await new Promise((r) => setTimeout(r, 10));
  return id as string;
}

test('真实执行器完成规则工具续轮和候选提交，正式稿保持原样，改规则后阻止旧任务续跑', async () => {
  const root = copySkill();
  let count = 0;
  let service: Service;
  service = await setup(async (_profile, _system, messages, tools) => {
    count++;
    assert.ok(tools.some((t) => t.name === 'read_naming_rules'));
    if (count === 1)
      return response([
        { id: 'rules', name: 'read_naming_rules', arguments: JSON.stringify({ ids: ['G04', 'T01'] }) }
      ]);
    if (count === 2) {
      const result = JSON.parse(messages.at(-1)!.content);
      assert.deepEqual(
        result.modules.map((m: { id: string }) => m.id),
        ['G04', 'T01']
      );
      const content = templates(root)['设定拆解'].replace(/：\s*$/gm, '：已确认背景内的事件');
      return response([
        {
          id: 'candidate',
          name: 'propose_changes',
          arguments: JSON.stringify({
            changes: [{ path: paths.seed, baseHash: service.store!.read(paths.seed).hash, content }]
          })
        }
      ]);
    }
    return response();
  }, root);
  try {
    const old = service.store!.read(paths.seed);
    const id = await start(service);
    const run = service.store!.db.run(id);
    assert.equal(count, 2);
    assert.equal(run.status, 'awaiting_review', run.error ?? JSON.stringify(run.issues));
    assert.equal(run.changes.length, 1);
    assert.equal(run.accepted, false);
    assert.deepEqual(service.store!.read(paths.seed), old);
    fs.appendFileSync(path.join(root, 'references/naming-system.md'), '\n未预载修订测试。\n');
    await service.runner!.drive(id);
    assert.equal(count, 2);
    assert.match(service.store!.db.run(id).error!, /规则或工具契约发生变化/);
    assert.deepEqual(service.store!.read(paths.seed), old);
  } finally {
    service.close();
  }
});

test('命名规则缺失时不发请求；调用中被修改时不保存新候选', async () => {
  const root = copySkill();
  const file = path.join(root, 'references/naming-system.md');
  let calls = 0;
  const service = await setup(async () => {
    calls++;
    fs.appendFileSync(file, '\n执行期间发生规则修改。\n');
    return response([
      {
        id: 'write',
        name: 'propose_changes',
        arguments: JSON.stringify({
          changes: [
            { path: paths.seed, baseHash: service.store!.read(paths.seed).hash, content: '# 不应提交' }
          ]
        })
      }
    ]);
  }, root);
  try {
    fs.writeFileSync(file, '损坏规则');
    const id = await start(service);
    assert.equal(calls, 0);
    assert.equal(service.store!.db.run(id).status, 'paused');
    assert.match(service.store!.db.run(id).error!, /命名规则版本/);
    fs.writeFileSync(file, source());
    await service.runner!.drive(id);
    assert.equal(calls, 1);
    const run = service.store!.db.run(id);
    assert.equal(run.status, 'paused');
    assert.match(run.error!, /执行期间已改变/);
    assert.deepEqual(run.changes, []);
  } finally {
    service.close();
  }
});
