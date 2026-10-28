import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { expressionLibrary, expressionPack, expressionFingerprint } from '../src/core/expression-rules';
import { configSchema, profileSchema, type ModelResult, type SecretProfile } from '../src/shared/types';
import { Service } from '../src/core/service';
import { hash, id, now } from '../src/core/domain';
import type { Caller } from '../src/core/runner';
import { splitSharedRules } from '../src/core/runtime/prompt-cache';

const skill = path.resolve('resources/skill');

test('规划、正文、审稿和记忆共享逐字相同的表达基础，模式与全部适用规则仍保留', () => {
  const config = configSchema.parse({});
  const library = expressionLibrary(skill);
  const packs = (['planning','prose','review','record'] as const).map(mode=>expressionPack(skill,config,mode));
  const base = packs.map(p=>splitSharedRules(p.prompt).rules.find(r=>r.includes('key="expression-base"')));
  assert.ok(base[0]);
  for (const [i,p] of packs.entries()) {
    assert.equal(base[i],base[0]);
    for(const rule of library.rules.filter(r=>p.binding!.ruleIds.includes(r.id)))
      for(const value of [rule.trigger,rule.repair,...rule.exceptions,...rule.preserve,...rule.do_not,...rule.context_required])
        assert.ok(p.prompt.includes(value),`${p.binding!.mode}/${rule.id} 必要内容缺失`);
    const parts=splitSharedRules(p.prompt);
    assert.match(parts.remaining,new RegExp(`mode="${p.binding!.mode}"`));
    assert.ok(!parts.remaining.includes('[LEX-001]'));
  }
});
const profile: SecretProfile = {
  ...profileSchema.parse({
    id: 'test',
    name: '本地夹具',
    protocol: 'chat',
    baseUrl: 'http://127.0.0.1:1',
    model: 'mock',
    contextLimit: 128000,
    outputLimit: 4096
  }),
  apiKey: 'test-only'
};
const response = (text: string, calls: ModelResult['calls'] = []): ModelResult => ({
  text,
  calls,
  native: null,
  usage: { input: 1, output: 1, cost: 0, currency: 'USD' },
  stop: calls.length ? 'tools' : 'complete'
});
async function setup(caller: Caller) {
  const service = new Service(skill, () => {}, caller);
  service.profiles = [structuredClone(profile)];
  await service.invoke('project.create', {
    parent: fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-expression-')),
    title: '自然表达验收',
    premise: '渡船上的两个人正在争论，关系尚未确定。'
  });
  return { service, chatId: service.snapshot().conversations![0].id };
}
async function idle(service: Service) {
  const until = Date.now() + 10000;
  while (service.chat?.controller || service.runner?.controller) {
    if (Date.now() > until) throw new Error('本地夹具超时');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test('905条来源保持完整；讨论和正文分别加载完整的生效规则，保留例外与原文约束', () => {
  const library = expressionLibrary(skill);
  assert.equal(library.rules.length, 905);
  assert.equal(library.catalog.modules.length, 145);
  const config = configSchema.parse({});
  const discussion = expressionPack(skill, config, 'discussion');
  const prose = expressionPack(skill, config, 'prose');
  assert.equal(discussion.binding!.ruleIds.length, 48);
  assert.equal(prose.binding!.ruleIds.length, 192);
  assert.ok(!discussion.binding!.ruleIds.includes('META-001'));
  assert.match(discussion.prompt, /必要的列表、分析、创作术语和解释可以保留/);
  assert.match(prose.prompt, /当前只生成小说正文/);
  assert.match(prose.prompt, /书信体、聊天体中人物确实在回应另一人物/);
  for (const pack of [discussion, prose]) {
    for (const rule of library.rules.filter((r) => pack.binding!.ruleIds.includes(r.id))) {
      for (const text of [
        rule.trigger,
        rule.repair,
        ...rule.exceptions,
        ...rule.preserve,
        ...rule.do_not,
        ...rule.context_required
      ])
        assert.ok(pack.prompt.includes(text), `规则内容不能丢失：${rule.id} ${text}`);
    }
    assert.equal(pack.binding!.promptHash, hash(pack.prompt));
  }
  assert.ok(Buffer.byteLength(discussion.prompt) < 15000);
  assert.ok(Buffer.byteLength(prose.prompt) < 60000);
});

test('题材与关系只按显式选择加入；关闭生效；未知模块拒绝', () => {
  const config = configSchema.parse({ genre: '双男主都市重生' });
  const ordinary = expressionPack(skill, config, 'prose');
  assert.ok(!ordinary.binding!.modules.includes('MM'));
  assert.ok(!ordinary.binding!.modules.includes('REBIRTH'));
  const selected = configSchema.parse({ expressionRules: { modules: ['URBAN', 'REBIRTH'] } });
  const pack = expressionPack(skill, selected, 'prose');
  assert.ok(pack.binding!.ruleIds.includes('URBAN-001'));
  assert.ok(pack.binding!.ruleIds.includes('REBIRTH-001'));
  assert.ok(!pack.binding!.modules.includes('MM'));
  assert.notEqual(expressionFingerprint(skill, config), pack.fingerprint);
  assert.equal(
    expressionPack(skill, configSchema.parse({ expressionRules: { enabled: false } }), 'discussion').prompt,
    ''
  );
  assert.throws(
    () => expressionPack(skill, configSchema.parse({ expressionRules: { modules: ['INVALID'] } }), 'prose'),
    /未知表达规则/
  );
});

test('规则资源被修改时中止，不能静默使用旧缓存或漏掉规则', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-rules-'));
  fs.cpSync(path.join(skill, 'expression'), path.join(root, 'expression'), { recursive: true });
  expressionLibrary(root);
  fs.appendFileSync(path.join(root, 'expression/rules_master.json'), ' ');
  assert.throws(() => expressionPack(root, configSchema.parse({}), 'discussion'), /完整性检查失败/);
});

test('长对话压缩后每轮和工具续轮仍携带规则，自由试写使用正文规则并记录版本', async () => {
  const requests: string[] = [];
  const { service, chatId } = await setup(async (_p, system) => {
    requests.push(system);
    return requests.length === 1
      ? response('', [{ id: 'read-1', name: 'read_rule', arguments: JSON.stringify({ name: 'editor' }) }])
      : response('他把缆绳放回船头，没有接话。');
  });
  try {
    for (let n = 0; n < 28; n++)
      service.chat!.records.save('conversation_messages', {
        id: id(),
        conversationId: chatId,
        turnId: `past-${n}`,
        role: n % 2 ? 'assistant' : 'user',
        content: `旧讨论${n}：人物仍在渡船上。`,
        createdAt: now(),
        status: 'complete',
        citations: []
      });
    await service.invoke('chat.send', {
      conversationId: chatId,
      profileId: 'test',
      text: '这段争论怎样写得自然'
    });
    await idle(service);
    assert.equal(requests.length, 2);
    for (const system of requests) {
      assert.match(system, /mode="discussion"/);
      assert.match(system, /\[SYN-001\]/);
      assert.match(system, /较早消息已转为可回查摘要/);
    }
    const chat = await service.invoke('chat.read', { id: chatId });
    assert.ok(chat.turns[0].expressionRules);
    assert.equal(chat.turns[0].expressionRules.ruleIds.length, 48);
    assert.equal(service.snapshot().runs.length, 0);
    const card = await service.invoke('proposal.create', {
      conversationId: chatId,
      profileId: 'test',
      proposal: {
        kind: 'draft',
        goal: '试写',
        scope: '渡船上的短段落',
        request: '只试写一小段对白',
        outputs: ['独立草稿']
      }
    });
    await service.invoke('proposal.confirm', { id: card.id, version: card.version });
    await idle(service);
    assert.match(requests.at(-1)!, /mode="draft"/);
    assert.match(requests.at(-1)!, /\[META-001\]/);
    const updated = await service.invoke('chat.read', { id: chatId });
    const draftTurn = updated.turns.find((t) => t.kind === 'draft');
    assert.ok(draftTurn?.expressionRules);
    assert.equal(draftTurn.expressionRules.ruleIds.length, 192);
    assert.equal(service.snapshot().runs.length, 0);
  } finally {
    service.close();
  }
});

test('每次新讨论读取当前开关；任务卡在规则选择改变后失效；配置保存拒绝无效模块', async () => {
  const systems: string[] = [];
  const { service, chatId } = await setup(async (_p, system) => {
    systems.push(system);
    return response('先明确人物要争取什么。');
  });
  try {
    const config = service.store!.db.project().config;
    const card = await service.invoke('proposal.create', {
      conversationId: chatId,
      profileId: 'test',
      proposal: { kind: 'draft', goal: '试写', scope: '开场', request: '试写开场', outputs: ['独立草稿'] }
    });
    await assert.rejects(
      service.invoke('project.configure', {
        config: { ...config, expressionRules: { enabled: true, modules: ['BAD'] } }
      }),
      /未知表达规则/
    );
    await service.invoke('project.configure', {
      config: { ...config, expressionRules: { enabled: false, modules: [] } }
    });
    await assert.rejects(
      service.invoke('proposal.confirm', { id: card.id, version: card.version }),
      /变化|失效/
    );
    await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '说说人物动机' });
    await idle(service);
    assert.doesNotMatch(systems.at(-1)!, /<expression_rules/);
    await service.invoke('project.configure', {
      config: { ...config, expressionRules: { enabled: true, modules: ['URBAN'] } }
    });
    await service.invoke('chat.send', { conversationId: chatId, profileId: 'test', text: '再讨论人物处境' });
    await idle(service);
    assert.match(systems.at(-1)!, /\[URBAN-001\]/);
  } finally {
    service.close();
  }
});

test('工具续轮前规则改变会停下，不混用版本；预算不足不删规则继续收费', async () => {
  let calls = 0;
  let service: Service;
  const context = await setup(async () => {
    calls++;
    const p = service.store!.db.project();
    p.config.expressionRules.enabled = false;
    service.store!.db.set('project', p);
    return response('', [{ id: 'read-1', name: 'read_rule', arguments: JSON.stringify({ name: 'editor' }) }]);
  });
  service = context.service;
  try {
    await service.invoke('chat.send', {
      conversationId: context.chatId,
      profileId: 'test',
      text: '讨论主角困境'
    });
    await idle(service);
    assert.equal(calls, 1);
    let chat = await service.invoke('chat.read', { id: context.chatId });
    assert.ok(chat.turns[0].error);
    assert.match(chat.turns[0].error, /依据.*变化|规则.*改变/);
    const p = service.store!.db.project();
    p.config.expressionRules.enabled = true;
    service.store!.db.set('project', p);
    service.profiles[0].contextLimit = 5000;
    service.profiles[0].outputLimit = 1024;
    await service.invoke('chat.send', {
      conversationId: context.chatId,
      profileId: 'test',
      text: '继续讨论'
    });
    await idle(service);
    assert.equal(calls, 1);
    chat = await service.invoke('chat.read', { id: context.chatId });
    assert.ok(chat.turns.some((t: any) => /容量不足/.test(t.error)));
  } finally {
    service.close();
  }
});

test('正式修订在工具续轮与恢复时保留表达约束和防过度改写规则', async () => {
  const requests: string[] = [];
  const { service } = await setup(async (_p, system) => {
    requests.push(system);
    return response('', [
      {
        id: `ask-${requests.length}`,
        name: 'ask_author',
        arguments: JSON.stringify({ question: '请确认具体段落' })
      }
    ]);
  });
  try {
    // This case verifies preserved revision rules, not the context-limit guard.
    // Allow the complete current rule pack; the preceding test covers rejection.
    service.profiles = [{ ...structuredClone(profile), contextLimit: 200000 }];
    const runId = await service.invoke('run.start', {
      mode: 'revision',
      request: '仅修订表达',
      profileId: 'test'
    });
    await idle(service);
    const firstRun = service.store!.db.run(runId);
    assert.equal(firstRun.status, 'awaiting_input', JSON.stringify({ error: firstRun.error, issues: firstRun.issues, failure: firstRun.failure, requests: requests.length }));
    await service.invoke('run.answer', { id: runId, answer: '只处理第一段的套话' });
    await idle(service);
    assert.equal(requests.length, 2, service.store!.db.run(runId).error ?? '');
    for (const system of requests) {
      assert.match(system, /mode="revision"/);
      assert.match(system, /\[EDIT-001\]/);
      assert.match(system, /\[SYN-001\]/);
    }
    assert.equal(service.store!.db.run(runId).expressionRules!.revision!.ruleIds.length, 204);
  } finally {
    service.close();
  }
});
