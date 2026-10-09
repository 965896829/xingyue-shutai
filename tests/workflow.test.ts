import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Service } from '../src/core/service';
import { templates } from '../src/core/skill';
import { profileSchema, type ProjectState, type ModelResult } from '../src/shared/types';
import {
  paths,
  stageOutputs,
  activeBatch,
  batchPath,
  rhythmPath,
  taskPath,
  detailPath,
  prosePath,
  updatePath,
  qualityPath,
  renderConfig,
  countWords,
  archivePath
} from '../src/core/domain';
import { importLegacy, previewLegacy } from '../src/core/migration';
import { FileStore } from '../src/core/storage';
const root = path.resolve('resources/skill');
import { fixture } from './fixtures/workflow';
test('S01—S11 全流程、正文记忆一次批准与批次归档', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-full-'));
  let service: Service;
  service = new Service(
    root,
    () => {},
    async (_p, _s, messages, tools, _signal, onDelta) => {
      const current = service.store!.db.project();
      if (!tools.length) {
        const prose = fixture(current, prosePath(current.chapter), service);
        const text = _s.includes('rubric narrative-1')
          ? JSON.stringify({
              values: { pressure: 3, payoff: 3, emotion: 3, revelation: null, relationship: null },
              quotes: [prose.slice(-12)],
              note: '夹具判断'
            })
          : prose;
        onDelta?.(text);
        return {
          text,
          calls: [],
          native: {},
          usage: { input: 1, output: 1, cost: 0, currency: 'USD' },
          stop: 'complete'
        };
      }
      if (messages.at(-1)?.role === 'tool')
        return {
          text: '候选完成',
          calls: [],
          native: { role: 'assistant', content: '候选完成' },
          usage: { input: 1, output: 1, cost: 0, currency: 'USD' },
          stop: 'complete'
        };
      const p = service.store!.db.project(),
        phase = service.store!.db.runs().find((r) => r.status === 'running')?.pipeline?.phase,
        outputs =
          phase === 'review'
            ? [qualityPath(p.chapter)]
            : stageOutputs(phase === 'memory' ? 'S11' : p.stage, p),
        changes = outputs.map((file) => ({
          path: file,
          baseHash: service.store!.db.document(file)?.hash ?? null,
          content: fixture(p, file, service)
        }));
      return {
        text: '生成候选',
        calls: [
          {
            id: `${p.stage}-${p.chapter}-${phase ?? ''}`,
            name: 'propose_changes',
            arguments: JSON.stringify({ changes })
          }
        ],
        native: { role: 'assistant', content: '生成候选' },
        usage: { input: 1, output: 1, cost: 0, currency: 'USD' },
        stop: 'tools'
      };
    }
  );
  service.profiles = [
    {
      ...profileSchema.parse({
        id: 'mock',
        name: 'fixture',
        protocol: 'chat',
        model: 'm',
        baseUrl: 'http://127.0.0.1:1/v1',
        stream: false,
        contextLimit: 1000000
      }),
      apiKey: 'fixture'
    }
  ];
  service.profiles.push(...['extractor', 'reviewer'].map((id) => ({ ...service.profiles[0], id, name: id })));
  try {
    await service.invoke('project.create', {
      parent,
      title: '全流程',
      premise: '一位伤员求医',
      config: {
        targetWords: 400,
        chapterWords: 200,
        minWords: 200,
        maxWords: 200,
        batchSize: 2,
        modelRouting: { writing: 'mock', extraction: 'extractor', review: 'reviewer' }
      }
    });
    assert.equal(service.store!.scan().length, 25);
    let stages = 0;
    while (!service.store!.db.project().finished) {
      const p = service.store!.db.project(),
        id = await service.invoke('run.start', { request: `执行 ${p.stage}`, profileId: 'mock' });
      while (service.runner!.controller) await new Promise((r) => setTimeout(r, 10));
      const r = service.store!.db.run(id);
      assert.equal(r.status, 'awaiting_review', `${r.stage}: ${JSON.stringify(r.issues)} ${r.error}`);
      if (r.pipeline) {
        assert.ok(r.steps?.some((s) => s.phase === 'prose' && s.profileId === 'mock'));
        assert.ok(r.steps?.some((s) => s.phase === 'review' && s.profileId === 'reviewer'));
        assert.ok(r.steps?.some((s) => s.phase === 'memory' && s.profileId === 'extractor'));
      }
      await service.invoke('run.accept', {
        id,
        proposalHash: r.proposalHash,
        startNext: false,
        warningReason: '测试夹具：仅验证结构与状态，不代表文学质量'
      });
      stages++;
      if (p.stage === 'S10') {
        assert.equal(service.store!.db.project().chapters[p.chapter], 'complete');
        if (!service.store!.db.project().finished) assert.notEqual(service.store!.db.project().stage, 'S11');
      }
      if (stages > 20) throw new Error('流程没有结束');
    }
    assert.equal(stages, 12);
    assert.equal(service.store!.db.project().chapters[2], 'complete');
    assert.ok(
      service.store!.read(archivePath(activeBatch(service.store!.db.project()))).content.includes('第2章')
    );
    assert.match(service.store!.read(paths.summary).content, /摘要覆盖回执/);
  } finally {
    service.close();
  }
});
test('旧档案复制保持原始 UTF-8 BOM、CRLF、备注和九列表格字节', () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-legacy-')),
    parent = fs.mkdtempSync(path.join(os.tmpdir(), 'wenxu-import-'));
  fs.mkdirSync(path.join(source, '04_人物记忆库'));
  const raw = Buffer.from('\uFEFF# 角色卡\r\n\r\n<!-- 自由备注 -->\r\n|甲|乙|丙|丁|戊|己|庚|辛|壬|\r\n');
  fs.writeFileSync(path.join(source, paths.roles), raw);
  const preview = previewLegacy(source);
  assert.equal(preview.files.length, 1);
  const target = importLegacy({ source, parent, title: '旧稿', chapter: 1, stage: 'S01', config: {} });
  assert.deepEqual(fs.readFileSync(path.join(target, paths.roles)), raw);
  assert.deepEqual(fs.readFileSync(path.join(source, paths.roles)), raw);
  const s = new FileStore(target);
  try {
    assert.ok(s.db.project().stale.includes(paths.roles));
  } finally {
    s.close();
  }
});
