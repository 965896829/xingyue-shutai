import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { Service } from '../src/core/service';
import { StoryLabService } from '../src/core/story-lab/service';
import { LabStore } from '../src/core/story-lab/store';
import {
  labGenerateSchema,
  labRequirementsSchema,
  labHeadings,
  type LabGenerate
} from '../src/shared/story-lab';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { attempts } from '../src/core/runtime/model-gateway';
import { RequestError, type invokeModel } from '../src/core/provider';
import { gateEvent } from '../src/shared/event-gate';
import { commandContracts, parseInput } from '../src/shared/contracts';
import type { AppEvent } from '../src/shared/types';

const requirement = labRequirementsSchema.parse({
  idea: '东方玄幻＋脑洞＋规则怪谈',
  targetWords: '300万字',
  chapterWords: '2300—2700字',
  keep: '人物有自己的欲望和立场。',
  avoid: '不写机械短句。'
});
const blueprint =
  '# 一句话核心设定\n风停时，只有修伞人能听见雨。\n\n## 主角\n修伞人阿宁想要开一家夜铺。\n\n## 开篇事件\n有人带来一把漏着星光的伞。\n\n## 本书文风\n自然完整的中文。\n\n## 结局方向\n远期秘密不提前揭露。';
function setup(caller: typeof invokeModel = async () => fakeResult(blueprint)) {
  const events: AppEvent[] = [],
    profile = { ...structuredClone(fakeProfile), outputLimit: 8192 };
  const root = isolatedRoot('story-lab');
  const lab = new StoryLabService(
    root,
    path.resolve('resources/skill'),
    () => [profile],
    (event) => events.push(structuredClone(event)),
    caller
  );
  const session = lab.create({
    id: crypto.randomUUID(),
    requirements: requirement,
    profileId: profile.id,
    outputLimit: 8192
  }).session;
  return { lab, root, events, profile, session };
}
function input(sessionId: string, values: Partial<LabGenerate> = {}) {
  return labGenerateSchema.parse({
    sessionId,
    requestId: crypto.randomUUID(),
    action: 'blueprint',
    baseVersionId: null,
    ...values
  });
}
async function generate(lab: StoryLabService, request: LabGenerate) {
  lab.start(request);
  await lab.settled(request.sessionId);
  return lab.store.get('requests', request.requestId)!;
}

test('independent first generation: one real gateway attempt, no project, no old prompt or tools, scoped events and safe config', async () => {
  let calls = 0;
  const s = setup(async (profile, system, messages, tools, _signal, delta, options) => {
    calls++;
    assert.equal(profile.tools, false);
    assert.equal(profile.stream, true);
    assert.equal(profile.networkRecovery?.maxRetries, 0);
    assert.equal(profile.networkRecovery?.retryUnknown, false);
    assert.deepEqual(tools, []);
    assert.match(system, /自由创作实验室/);
    assert.match(system, /17\. 下一步创作/);
    assert.doesNotMatch(
      system + messages[0].content,
      /S01|S11|agent\.md|章后记忆|propose_changes|memory_extract/
    );
    assert.match(messages[0].content, /300万字/);
    assert.match(messages[0].content, /2300—2700字/);
    assert.match(options!.promptCacheKey!, /^wenxu-v1-/);
    delta?.(blueprint.slice(0, 20));
    delta?.(blueprint.slice(20));
    return fakeResult(blueprint);
  });
  try {
    const request = input(s.session.id),
      result = await generate(s.lab, request);
    assert.equal(calls, 1);
    assert.equal(result.attempts, 1);
    assert.equal(result.status, 'complete');
    assert.equal(s.lab.store.journal.db.project(), undefined);
    assert.equal(s.lab.store.session(s.session.id).currentVersionId, null);
    assert.equal(s.lab.store.version(s.session.id, result.versionId!).content, blueprint);
    assert.equal(s.profile.tools, true);
    assert.equal(JSON.stringify(result).includes(s.profile.apiKey), false);
    const journal = attempts(s.lab.store.journal, result.id);
    assert.equal(journal.length, 1);
    assert.equal(journal[0].purpose, 'story-lab:blueprint');
    const actual = s.lab.store.journal.object(journal[0].requestRef!).toString();
    assert.match(actual, /自由创作实验室/);
    assert.doesNotMatch(actual, /fixture-only-secret|S01|S11/);
    for (const event of s.events) {
      assert.equal(event.workspace, 'story-lab');
      assert.equal(event.sessionId, s.session.id);
      assert.equal(event.projectId, undefined);
      assert.equal(event.projectSessionId, undefined);
      assert.equal(gateEvent({ seq: 0, waiting: false }, event), 'ignore');
    }
    assert.deepEqual(
      s.events.map((e) => e.sequence),
      s.events.map((_, i) => i + 1)
    );
    s.lab.start(request);
    assert.equal(calls, 1);
    assert.throws(() => s.lab.start({ ...request, instruction: '另一个要求' }), /同一请求编号/);
  } finally {
    await s.lab.close();
  }
});

test('local replacement keeps untouched bytes, preserves original, manual edits and stale model candidates require explicit selection', async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let call = 0;
  const s = setup(async () => {
    if (++call === 1) return fakeResult(blueprint);
    await gate;
    return fakeResult('## 主角\n阿宁不再苦大仇深。\n\n');
  });
  try {
    const first = await generate(s.lab, input(s.session.id));
    s.lab.select({
      sessionId: s.session.id,
      versionId: first.versionId!,
      expectedRevision: 0,
      reviewedStale: false
    });
    const h = labHeadings(blueprint).find((h) => h.title === '主角')!;
    const req = input(s.session.id, {
      action: 'revise',
      baseVersionId: first.versionId,
      instruction: '背景保留，但不要苦大仇深',
      selection: { start: h.start, end: h.end, text: blueprint.slice(h.start, h.end) }
    });
    s.lab.start(req);
    const manual = s.lab.edit({
      sessionId: s.session.id,
      baseVersionId: first.versionId!,
      content: blueprint + '\n作者新增原句。',
      title: '手改',
      expectedRevision: 1
    });
    const edited = manual.versions.at(-1)!;
    s.lab.select({
      sessionId: s.session.id,
      versionId: edited.id,
      expectedRevision: 2,
      reviewedStale: false
    });
    release();
    await s.lab.settled(s.session.id);
    const candidate = s.lab.store.version(
      s.session.id,
      s.lab.store.get('requests', req.requestId)!.versionId!
    );
    assert.equal(
      candidate.content,
      blueprint.slice(0, h.start) + '## 主角\n阿宁不再苦大仇深。\n\n' + blueprint.slice(h.end)
    );
    assert.equal(s.lab.store.session(s.session.id).currentVersionId, edited.id);
    assert.equal(s.lab.store.version(s.session.id, first.versionId!).content, blueprint);
    assert.throws(
      () =>
        s.lab.select({
          sessionId: s.session.id,
          versionId: candidate.id,
          expectedRevision: 3,
          reviewedStale: false
        }),
      /较早版本/
    );
    s.lab.select({
      sessionId: s.session.id,
      versionId: candidate.id,
      expectedRevision: 3,
      reviewedStale: true
    });
    assert.equal(s.lab.store.version(s.session.id, edited.id).content.endsWith('作者新增原句。'), true);
  } finally {
    release?.();
    await s.lab.close();
  }
});

test('continuation includes requirements, selected plan, prior text and interruption; appends one new fragment', async () => {
  let call = 0;
  const s = setup(async (_p, _s, messages) => {
    if (++call === 1) return { ...fakeResult(blueprint), stop: 'length' };
    assert.match(messages[0].content, /中断位置/);
    assert.ok(messages[0].content.includes(blueprint));
    return fakeResult('\n后来雨停了。');
  });
  try {
    const first = await generate(s.lab, input(s.session.id));
    assert.equal(first.status, 'length');
    const next = await generate(
      s.lab,
      input(s.session.id, {
        action: 'continue',
        baseVersionId: first.versionId,
        sourceVersionId: first.versionId!,
        instruction: '只继续当前开篇'
      })
    );
    assert.equal(
      s.lab.store.version(s.session.id, next.versionId!).content,
      blueprint + '\n\n\n后来雨停了。'
    );
    assert.equal(next.response, '\n后来雨停了。');
    assert.equal(call, 2);
    assert.equal(next.attempts, 1);
  } finally {
    await s.lab.close();
  }
});

test('unknown network outcome retains partial output and null cost; no retry, including after reopening', async () => {
  let calls = 0;
  const s = setup(async (_p, _s, _m, _t, _signal, delta) => {
    calls++;
    delta?.('原文未结束');
    throw new RequestError('网络断开', true);
  });
  const req = input(s.session.id);
  const result = await generate(s.lab, req);
  assert.equal(result.status, 'unknown');
  assert.equal(result.response, '原文未结束');
  assert.equal(result.usage.cost, null);
  assert.throws(() => s.lab.start(input(s.session.id)), /此前存在/);
  s.lab.start(req);
  assert.equal(calls, 1);
  await s.lab.close();
  const reopened = new StoryLabService(
    s.root,
    path.resolve('resources/skill'),
    () => [s.profile],
    () => {},
    async () => {
      throw new Error('不得重发');
    }
  );
  try {
    assert.equal(reopened.start(req).status, 'unknown');
    assert.equal(reopened.store.all('versions', s.session.id)[0].content, '原文未结束');
  } finally {
    await reopened.close();
  }
});

test('concurrent sessions route streams to original identity and cancellation is request-local', async () => {
  const s = setup(async (_p, _s, messages, _t, signal, delta) => {
    delta?.(messages[0].content.includes('第二个实验') ? '第二会话' : '第一会话');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 120);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new RequestError('停止', true));
        },
        { once: true }
      );
    });
    return fakeResult('独立完成');
  });
  try {
    const second = s.lab.create({
      id: crypto.randomUUID(),
      requirements: { ...requirement, idea: '第二个实验' },
      profileId: s.profile.id,
      outputLimit: 8192
    }).session;
    const a = input(s.session.id),
      b = input(second.id);
    s.lab.start(a);
    s.lab.start(b);
    await new Promise((resolve) => setTimeout(resolve, 20));
    s.lab.cancel(s.session.id, b.requestId);
    assert.equal(s.lab.store.get('requests', a.requestId)!.status, 'running');
    s.lab.cancel(s.session.id, a.requestId);
    await Promise.all([s.lab.settled(s.session.id), s.lab.settled(second.id)]);
    assert.equal(s.lab.store.get('requests', a.requestId)!.status, 'cancelled');
    assert.equal(s.lab.store.get('requests', a.requestId)!.response, '第一会话');
    assert.equal(s.lab.store.get('requests', b.requestId)!.status, 'complete');
    assert.ok(s.events.filter((e) => e.requestId === a.requestId).every((e) => e.sessionId === s.session.id));
    assert.ok(s.events.filter((e) => e.requestId === b.requestId).every((e) => e.sessionId === second.id));
  } finally {
    await s.lab.close();
  }
});

test('configuration snapshot, conservative prose context and visible exclusions preserve author requirements', async () => {
  let call = 0,
    sentModel = '';
  const s = setup(async (p, system, messages) => {
    sentModel = p.model;
    if (++call === 1) return fakeResult(blueprint);
    assert.match(system, /只交小说正文/);
    assert.doesNotMatch(system, /17\. 下一步创作/);
    assert.doesNotMatch(messages[0].content, /远期秘密不提前揭露/);
    assert.match(messages[0].content, /不改主角职业/);
    return fakeResult('第一章\n雨从伞里漏了下来。');
  });
  try {
    const first = await generate(s.lab, input(s.session.id));
    s.lab.select({
      sessionId: s.session.id,
      versionId: first.versionId!,
      expectedRevision: 0,
      reviewedStale: false
    });
    s.lab.update({
      sessionId: s.session.id,
      expectedRevision: 1,
      pins: ['不改主角职业'],
      profileId: s.profile.id,
      outputLimit: 4096
    });
    const req = input(s.session.id, {
      action: 'prose',
      baseVersionId: first.versionId,
      instruction: '试写第一章'
    });
    const preview = s.lab.preview(req);
    assert.ok(preview.sources.some((s) => s.includes('开篇事件')));
    assert.equal(preview.outputLimit, 4096);
    s.lab.start(req);
    s.profile.model = 'changed-after-dispatch';
    await s.lab.settled(s.session.id);
    assert.equal(s.lab.store.get('requests', req.requestId)!.status, 'complete');
    assert.equal(sentModel, fakeProfile.model);
    assert.equal(s.lab.store.get('requests', req.requestId)!.model.outputLimit, 4096);
    assert.equal(s.profile.outputLimit, 8192);
    assert.equal(s.profile.tools, true);
  } finally {
    await s.lab.close();
  }
});

test('reasoning preference is captured and sent unchanged through the shared gateway', async () => {
  const s = setup(async (profile) => {
    assert.equal(profile.reasoningEffort, 'low');
    return fakeResult(blueprint);
  });
  s.profile.model = 'gpt-6.1-sol';
  s.profile.protocol = 'responses';
  s.profile.reasoningEffort = 'low';
  try {
    const req = input(s.session.id);
    s.lab.start(req);
    s.profile.reasoningEffort = 'high';
    await s.lab.settled(s.session.id);
    const result = s.lab.store.get('requests', req.requestId)!;
    assert.equal(result.status, 'complete');
    assert.equal(result.model.reasoningEffort, 'low');
    const body = JSON.parse(
      s.lab.store.journal.object(attempts(s.lab.store.journal, req.requestId)[0].requestRef!).toString()
    ).request;
    assert.equal(body.reasoning.effort, 'low');
    assert.equal(result.attempts, 1);
  } finally {
    await s.lab.close();
  }
});

test('context overflow and invalid ranges dispatch zero requests; no silent trimming', async () => {
  let calls = 0;
  const s = setup(async () => {
    calls++;
    return fakeResult(blueprint);
  });
  try {
    s.profile.contextLimit = 10000;
    const session = s.lab.create({
      id: crypto.randomUUID(),
      requirements: { ...requirement, existing: '作者原文'.repeat(10000) },
      profileId: s.profile.id,
      outputLimit: 8192
    }).session;
    assert.throws(() => s.lab.start(input(session.id)), /上下文|容量/);
    assert.equal(calls, 0);
    assert.equal(s.lab.store.all('requests', session.id).length, 0);
    assert.throws(
      () =>
        s.lab.start(
          input(s.session.id, {
            action: 'revise',
            instruction: '改',
            selection: { start: 0, end: 4, text: '不是原文' }
          })
        ),
      /基准版本/
    );
  } finally {
    await s.lab.close();
  }
});

test('opening and generating in lab does not mutate open formal project or attach its event metadata', async () => {
  let calls = 0;
  const events: AppEvent[] = [];
  const service = new Service(
    path.resolve('resources/skill'),
    (event) => events.push(event),
    async (_p, system, messages) => {
      calls++;
      assert.doesNotMatch(system + messages[0].content, /正式作品独有秘密/);
      return fakeResult(blueprint);
    }
  );
  service.profiles = [{ ...fakeProfile, outputLimit: 8192 }];
  service.storyLabRoot = isolatedRoot('lab-integration');
  try {
    await service.invoke('project.create', {
      parent: isolatedRoot('formal-lab-test'),
      title: '旧作品',
      premise: '正式作品独有秘密',
      config: { defaultProfileId: fakeProfile.id, stageBudget: 0 }
    });
    const project = JSON.stringify(service.store!.db.project()),
      docs = JSON.stringify(service.store!.documentListing()),
      projectSessionId = service.projectSessionId;
    const lab = await service.invoke('lab.create', {
      id: crypto.randomUUID(),
      requirements: requirement,
      profileId: fakeProfile.id,
      outputLimit: 8192
    });
    const req = input(lab.session.id);
    await service.invoke('lab.generate', req);
    for (let i = 0; i < 50; i++) {
      if ((await service.invoke('lab.read', { sessionId: lab.session.id })).requests[0].status !== 'running')
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(JSON.stringify(service.store!.db.project()), project);
    assert.equal(JSON.stringify(service.store!.documentListing()), docs);
    assert.equal(service.projectSessionId, projectSessionId);
    assert.equal(calls, 1);
    assert.ok(
      events
        .filter((e) => e.type === 'story-lab')
        .every((e) => !e.projectId && !e.projectSessionId && !e.snapshotId)
    );
    const exported = await service.invoke('lab.export', {
      sessionId: lab.session.id,
      versionId: (await service.invoke('lab.read', { sessionId: lab.session.id })).versions[0].id
    });
    assert.ok(exported.path.startsWith(service.storyLabRoot));
    assert.equal(fs.readFileSync(exported.path, 'utf8'), blueprint);
  } finally {
    await service.drain();
  }
});

test('lazy initialization failure is confined to lab and formal snapshot remains usable', async () => {
  const service = new Service(path.resolve('resources/skill'), () => {});
  const root = isolatedRoot('invalid-lab-root');
  fs.writeFileSync(path.join(root, 'not-directory'), 'x');
  service.storyLabRoot = path.join(root, 'not-directory');
  try {
    await assert.rejects(service.invoke('lab.list'));
    assert.equal((await service.invoke('app.snapshot')).project, null);
  } finally {
    await service.drain();
  }
});

test('an active formal stage and lab run concurrently; stopping the lab never cancels the formal signal', async () => {
  let formalSignal: AbortSignal | undefined;
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const service = new Service(
    path.resolve('resources/skill'),
    () => {},
    async (_profile, system, _messages, _tools, signal, delta) => {
      if (!system.includes('# 自由创作实验室')) {
        formalSignal = signal;
        ready();
      } else delta?.('实验室原文');
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new RequestError('取消', true)), { once: true })
      );
      return fakeResult();
    }
  );
  service.profiles = [{ ...fakeProfile, outputLimit: 8192 }];
  service.storyLabRoot = isolatedRoot('concurrent-formal-lab');
  try {
    await service.invoke('project.create', {
      parent: isolatedRoot('concurrent-formal'),
      title: '后台正式任务',
      premise: '工匠修复桥梁',
      config: { defaultProfileId: fakeProfile.id }
    });
    const runId = await service.invoke('run.start', { request: '建立设定', profileId: fakeProfile.id });
    await started;
    const lab = await service.invoke('lab.create', {
      id: crypto.randomUUID(),
      requirements: requirement,
      profileId: fakeProfile.id,
      outputLimit: 8192
    });
    const req = input(lab.session.id);
    await service.invoke('lab.generate', req);
    await new Promise((resolve) => setTimeout(resolve, 15));
    await service.invoke('lab.cancel', { sessionId: lab.session.id, requestId: req.requestId });
    assert.equal(formalSignal?.aborted, false);
    assert.equal(service.store!.db.run(runId).status, 'running');
    assert.ok(service.runner?.controller);
  } finally {
    await service.drain();
  }
});

test('shutdown cancels, persists partial output and does not automatically restart on reopening', async () => {
  const s = setup(async (_p, _s, _m, _t, signal, delta) => {
    delta?.('退出前的原文');
    await new Promise((_resolve, reject) =>
      signal.addEventListener('abort', () => reject(new RequestError('关闭', true)), { once: true })
    );
    return fakeResult();
  });
  const req = input(s.session.id);
  s.lab.start(req);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await s.lab.close();
  const store = new LabStore(s.root);
  try {
    assert.equal(store.get('requests', req.requestId)!.status, 'cancelled');
    assert.equal(store.all('versions')[0].content, '退出前的原文');
  } finally {
    store.close();
  }
});

test('crash recovery reconciles completed gateway results exactly once without replay', async () => {
  const s = setup();
  const req = input(s.session.id),
    completed = await generate(s.lab, req);
  // Simulate the gap after the gateway has durably saved the response, before lab finalization.
  s.lab.store.journal.db.sql.prepare('DELETE FROM lab_versions').run();
  s.lab.store.journal.db.sql
    .prepare("DELETE FROM lab_messages WHERE json_extract(data,'$.role')='assistant'")
    .run();
  s.lab.store.save('requests', { ...completed, status: 'running', response: '', versionId: null });
  await s.lab.close();
  const store = new LabStore(s.root);
  try {
    assert.equal(store.get('requests', req.requestId)!.status, 'complete');
    assert.equal(store.all('versions').length, 1);
    assert.equal(store.all('versions')[0].content, blueprint);
  } finally {
    store.close();
  }
});

test('Markdown navigation keeps raw text, ignores fenced headings, and commands reject file paths and extra requests', () => {
  const content = '无标题前言\r\n```md\n# 假标题\n```\n## 主角\n角色\n## 开篇\n开始';
  const headings = labHeadings(content);
  assert.deepEqual(
    headings.map((h) => h.title),
    ['主角', '开篇']
  );
  assert.equal(content.slice(headings[0].start, headings[0].end), '## 主角\n角色\n');
  assert.equal(commandContracts['lab.generate'].scope, 'global');
  assert.throws(() => parseInput('lab.generate', { ...input(crypto.randomUUID()), maxRequests: 2 }));
  assert.throws(() => parseInput('lab.export', { sessionId: crypto.randomUUID(), path: 'C:/secret' }));
});
