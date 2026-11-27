import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { acceptanceOutputRoot } from './fixtures/test-output';
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

test('实验室指定正文可离线转入当前作品，重复导入复用同份自由草稿', async () => {
  const { lab, root, session } = setup();
  const version = { id: crypto.randomUUID(), sessionId: session.id, kind: 'prose' as const, title: '试稿',
    content: '她把最后一把伞交给了来客。', createdAt: new Date().toISOString(), baseVersionId: null, requestId: null, partial: false, source: 'edit' as const };
  lab.store.save('versions', version);
  await lab.close();
  const service = new Service(path.resolve('resources/skill'), () => {}, async () => { throw new Error('意外模型请求'); });
  service.storyLabRoot = root;
  try {
    const created = await service.invoke('project.create', { parent: isolatedRoot('lab-import'), title: '雨伞', premise: '修伞人的故事' });
    const request = { projectId: created.project!.id, sessionId: session.id, versionId: version.id };
    await assert.rejects(service.invoke('draft.importLab', { ...request, projectId: '另一部书' }), /切换/);
    const draft = await service.invoke('draft.importLab', request);
    assert.equal((await service.invoke('draft.read', { id: draft.id })).content, version.content);
    assert.equal((await service.invoke('draft.importLab', request)).id, draft.id);
    assert.equal((await service.invoke('draft.list')).length, 1);
    assert.equal(service.store!.db.project().revision, created.project!.revision);
  } finally { await service.drain(); }
});

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
      blueprint + '\n后来雨停了。'
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
    s.profile.hasKey = true;
    s.profile.apiKey = '';
    const preview = s.lab.preview(req);
    assert.ok(preview.sources.some((s) => s.includes('开篇事件')));
    assert.equal(preview.outputLimit, 4096);
    assert.throws(() => s.lab.start(req), /配置可用连接/);
    s.profile.apiKey = fakeProfile.apiKey;
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

test('讨论与纠偏引用本次实验的候选，并保留本轮要求；试写按实际层级取材', async () => {
  const original = [
    '# 河上书', '## 一句话核心设定', '### 桥上三条禁令', '河中呼名不可回应。',
    '## 世界核心与隐藏真相', '### 世界核心', '山河以神职授箓。', '### 隐藏真相', '河底最终秘密。',
    '## 成长体系', '### 渡箓的代价', '受箓者必须救人。', '## 开篇事件', '桥下有人求救。',
    '## 结局方向', '### 主角的真实身份', '终章才揭示的身份。'
  ].join('\n');
  const s = setup(async () => fakeResult(original));
  try {
    const first = await generate(s.lab, input(s.session.id));
    const request = (action: LabGenerate['action'], instruction: string, baseVersionId: string | null = first.versionId) =>
      input(s.session.id, { action, instruction, baseVersionId });
    const discuss = s.lab.preview(request('discuss', '刚才的方案为什么偏题？', null));
    assert.equal(discuss.baseVersionId, first.versionId);
    assert.ok(discuss.user.includes(original));
    assert.equal(s.lab.store.session(s.session.id).currentVersionId, null);
    const correction = '把两难写进破局，不用祭祀查案。';
    const corrected = s.lab.preview(request('blueprint', correction));
    assert.ok(corrected.user.includes(correction) && corrected.user.includes(original));
    const prose = request('prose', '试写第一章');
    const context = s.lab.preview(prose);
    for (const text of ['河中呼名不可回应。', '山河以神职授箓。', '受箓者必须救人。', '桥下有人求救。'])
      assert.equal(context.user.split(text).length, 2);
    assert.doesNotMatch(context.user, /河底最终秘密|终章才揭示的身份/);
    const onlyRules = s.lab.preview({ ...prose, sectionIndexes: [2] });
    assert.match(onlyRules.user, /河中呼名不可回应/);
    assert.doesNotMatch(onlyRules.user, /受箓者必须救人/);
  } finally { await s.lab.close(); }
});

test('补写、局部中断、重启恢复和下一章使用相应的正文及方案版本', async () => {
  const plan = '# 主角\n阿宁替人撑渡。\n## 世界核心与隐藏真相\n公开规则：船离水必沉。\n隐藏真相：星台是谁建的。\n## 第一卷\n旧路线。\n## 第二卷\n后卷原句。\n';
  const prose = '阿宁用最后的铜钱买了红伞，左手受伤，对师弟撒了谎。';
  const returns = [plan, '新路线：先找船。', prose, '换来一', '把青伞', '他空着钱袋上船。'];
  const wires: string[] = [];
  const caller: typeof invokeModel = async (_p, _system, messages) => {
    const index = wires.push(messages[0].content) - 1;
    return { ...fakeResult(returns[index]), stop: index === 3 ? 'length' : 'complete' };
  };
  const s = setup(caller); let lab = s.lab;
  const select = (versionId: string) => lab.select({ sessionId: s.session.id, versionId,
    expectedRevision: lab.store.session(s.session.id).revision, reviewedStale: false });
  const make = (data: Partial<LabGenerate>) => generate(lab, input(s.session.id, data));
  try {
    const whole = await make({}); select(whole.versionId!);
    const expansion = await make({ action: 'expand', baseVersionId: whole.versionId, instruction: '补充第1卷的主角路线' });
    select(expansion.versionId!);
    const merged = lab.store.version(s.session.id, expansion.versionId!).content;
    assert.ok(merged.startsWith(plan.slice(0, plan.indexOf('## 第二卷'))) && merged.endsWith('## 第二卷\n后卷原句。\n') && merged.includes('新路线：先找船。'));
    const first = await make({ action: 'prose', baseVersionId: expansion.versionId, proseMode: 'first', instruction: '写第一章' });
    select(first.versionId!); assert.match(wires[2], /船离水必沉/); assert.doesNotMatch(wires[2], /星台是谁建的|后卷原句/);
    const start = prose.indexOf('买了红伞'), end = start + 4;
    const partial = await make({ action: 'revise', baseVersionId: first.versionId, instruction: '改这句',
      selection: { start, end, text: prose.slice(start, end) } });
    assert.equal(lab.store.version(s.session.id, partial.versionId!).content, '换来一');
    assert.throws(() => select(partial.versionId!), /未完成/);
    await lab.close(); lab = new StoryLabService(s.root, path.resolve('resources/skill'), () => [s.profile], () => {}, caller);
    const resumed = await make({ action: 'continue', baseVersionId: expansion.versionId, sourceVersionId: partial.versionId!, instruction: '接着写' });
    select(resumed.versionId!);
    const updated = lab.store.version(s.session.id, resumed.versionId!).content;
    assert.equal(updated, prose.slice(0,start) + '换来一把青伞' + prose.slice(end));
    await make({ action: 'prose', baseVersionId: expansion.versionId, instruction: '紧接第一章写第二章' });
    assert.ok(wires[5].includes(updated) && wires[5].includes(resumed.versionId!));
    const solo = lab.preview(input(s.session.id, { action: 'prose', baseVersionId: expansion.versionId, proseMode: 'independent', instruction: '独立试写场景' }));
    const directory = path.join(acceptanceOutputRoot, 'writing-material-acceptance'); fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'lab.json'), JSON.stringify({ before: plan, expansion: { id: expansion.versionId, accepted: merged },
      prose: { before: prose, start, end, partial: partial.versionId, adopted: resumed.versionId, content: updated }, requests: wires }, null, 2));
    assert.ok(!solo.user.includes(updated));
  } finally { await lab.close(); }
});

test('按卷章编号定位补充，重号需要明确位置，新增部分有自己的标题', async () => {
  const plan = ['# 渡口', '## 第一卷 北岸', '### 第一章 潮生', '桥下起雾。', '## 第 ２ 卷 南岸',
    '### 第001章 夜航', '港口已空。', '## 尾声', '众人归家。', ''].join('\r\n');
  const replies = [plan, '斗篷打湿。', '## 第三章 灯起\r\n船灯亮了。', '另起航路。'];
  let calls = 0;
  const s = setup(async () => fakeResult(replies[calls++]));
  const adopt = (versionId: string) => s.lab.select({ sessionId: s.session.id, versionId,
    expectedRevision: s.lab.store.session(s.session.id).revision, reviewedStale: false });
  const supplement = (instruction: string) => input(s.session.id, { action: 'expand', instruction,
    baseVersionId: s.lab.store.session(s.session.id).currentVersionId });
  const apply = async (instruction: string) => {
    const result = await generate(s.lab, supplement(instruction));
    assert.equal(result.status, 'complete');
    adopt(result.versionId!);
    return s.lab.store.version(s.session.id, result.versionId!).content;
  };
  try {
    adopt((await generate(s.lab, input(s.session.id))).versionId!);
    assert.throws(() => s.lab.start(supplement('补充第1章')), /完整标题/);
    assert.equal(calls, 1);
    const nested = await apply('补充第二卷第一章');
    assert.equal(nested, plan.replace('港口已空。', '港口已空。\r\n\r\n斗篷打湿。\r\n'));
    const newChapter = await apply('补充第1卷的第003章');
    assert.equal(newChapter, nested.replace('桥下起雾。', '桥下起雾。\r\n\r\n### 第三章 灯起\r\n船灯亮了。\r\n'));
    const newVolume = await apply('补充第三卷');
    assert.equal(newVolume, newChapter + '\r\n# 第3卷\r\n\r\n另起航路。');
    assert.equal(calls, replies.length);
  } finally { await s.lab.close(); }
});

test('表格中截断逐字接续；核心构想接回原模板，完成后不重复展开尾段', async () => {
  const outputs = ['# 主角\n阿宁。\n| 路线 |', ' 代价 |\n', '## 结局方向\n回到渡口。'];
  const wires: string[] = [];
  const s = setup(async (_p, system, messages) => {
    const i = wires.push(system + messages[0].content) - 1;
    return { ...fakeResult(outputs[i]), stop: i === 0 ? 'length' : 'complete' };
  });
  try {
    const first = await generate(s.lab, input(s.session.id, { blueprintScope: 'core' }));
    const resume = (versionId: string) => input(s.session.id, { action: 'continue', baseVersionId: null, sourceVersionId: versionId, instruction: '继续' });
    const core = await generate(s.lab, resume(first.versionId!));
    assert.equal(s.lab.store.version(s.session.id, core.versionId!).content, outputs[0] + outputs[1]);
    const end = await generate(s.lab, resume(core.versionId!));
    assert.match(wires[2], /9—17项/); assert.match(wires[2], /17\. 下一步创作/);
    assert.equal(s.lab.store.version(s.session.id,end.versionId!).content, outputs.join(''));
    assert.throws(() => s.lab.preview(resume(end.versionId!)), /未完成/);
  } finally { await s.lab.close(); }
});

test('实验室按十二条翻页，按需取旧原文及请求，选中版本固定且读取不修改状态', async () => {
  const s = setup();
  try {
    const first = await generate(s.lab, input(s.session.id));
    s.lab.select({ sessionId: s.session.id, versionId: first.versionId!, expectedRevision: 0, reviewedStale: false });
    const ids = [first.versionId!];
    for (let i = 0; i < 25; i++) {
      const r = s.lab.edit({ sessionId: s.session.id, baseVersionId: ids.at(-1)!, title: '编辑' + i,
        expectedRevision: s.lab.store.session(s.session.id).revision, content: blueprint + '\n' + i });
      ids.push(r.versions.at(-1)!.id);
    }
    const stamp = s.lab.store.stamp(s.session.id), head = s.lab.store.detail(s.session.id);
    assert.equal(head.versions.length, 13); assert.equal(head.versions.filter(v => v.content).length, 2);
    assert.equal(head.requests[0].context.user, ''); assert.ok(s.lab.store.request(s.session.id, first.id).context.user.includes(requirement.idea));
    const middle = s.lab.store.detail(s.session.id, head.older);
    assert.equal(middle.versions.length, 12); assert.ok(middle.versions.every(v => !v.content));
    const tail = s.lab.store.detail(s.session.id, middle.older); assert.equal(tail.older, undefined);
    assert.equal(new Set([...head.versions, ...middle.versions, ...tail.versions].map(v => v.id)).size, ids.length);
    assert.equal(s.lab.store.version(s.session.id, ids[4]).content, blueprint + '\n3');
    assert.deepEqual(s.lab.store.stamp(s.session.id), stamp);
  } finally { await s.lab.close(); }
});
