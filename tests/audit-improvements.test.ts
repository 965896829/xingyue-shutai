import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { SkillRegistry, stageSkills } from '../src/core/skill-registry';
import { stageOutputs, newProject, prosePath, qualityPath, paths, hash, countWords } from '../src/core/domain';
import { checkProse, checkPublication, checkReviewEvidence, reviewAspects } from '../src/core/manuscript-check';
import { validateCandidate } from '../src/core/validation';
import { invokeModel, RequestError } from '../src/core/provider';
import { Service } from '../src/core/service';
import { fakeProfile, fakeResult, isolatedRoot } from './fixtures/refactor';
import { sampleProse } from './fixtures/workflow';
import { documentPreviewText } from '../src/shared/run-presentation';
import type { StageId } from '../src/shared/types';

const skill = path.resolve('resources/skill');

test('阶段技能和独立研究的文件契约均落在宿主实际允许的路径内', () => {
  const registry = new SkillRegistry(skill);
  const p = newProject('契约检查', 'isolated', {});
  const explicitPaths = (values: string[]) => values.flatMap(value => value.match(/^[\d][^\s]*?\.md/) ?? []);
  for (const [stage, skillId] of Object.entries(stageSkills)) {
    const entry = registry.get(skillId);
    const contract = JSON.parse(registry.read(entry.contract));
    const allowed = stageOutputs(stage as StageId, p);
    for (const output of explicitPaths(contract.outputs)) {
      const resolved = output.replaceAll('{chapter}', '001').replaceAll('{start}', '001').replaceAll('{end}', '030');
      assert.ok(allowed.includes(resolved), `${skillId}: ${resolved}`);
      assert.ok(![paths.progress, paths.index].includes(resolved as any));
      assert.ok(registry.read(entry.path).includes(output), `技能文字遗漏契约文件：${output}`);
    }
  }
  for (const skillId of ['webnovel-market-research', 'webnovel-packaging', 'webnovel-reader-feedback']) {
    const entry = registry.get(skillId);
    const contract = JSON.parse(registry.read(entry.contract));
    for (const output of explicitPaths(contract.outputs)) {
      assert.ok(output.startsWith('11_创作研究/'), output);
      assert.ok(registry.read(entry.path).includes(output));
    }
  }
  assert.match(registry.load(stageSkills.S01).content, /读者承诺写入设定拆解/);
});

test('读取未创建、未导入和真实外部修改文件时给出不同诊断', async () => {
  let service: Service;
  let requested = false;
  service = new Service(skill, () => {}, async () => {
    if (requested) return fakeResult();
    requested = true;
    fs.appendFileSync(path.join(service.store!.root, paths.seed), '\n作者新写的内容。');
    return { ...fakeResult(), stop: 'tools', calls: [
      ['missing', '02_项目配置/读者承诺.md'], ['untracked', '00_作者输入/未导入.md'], ['external', paths.seed]
    ].map(([callId, file]) => ({ id: callId, name: 'read_document', arguments: JSON.stringify({ path: file }) })) };
  });
  service.profiles = [{ ...fakeProfile, contextLimit: 200000 }];
  try {
    await service.invoke('project.create', { parent: isolatedRoot('read-diagnosis'), title: '文件诊断', premise: '检修员追查失踪的工具', config: { defaultProfileId: fakeProfile.id } });
    fs.writeFileSync(path.join(service.store!.root, '00_作者输入/未导入.md'), '尚未导入的作者资料');
    const run = service.makeRun('stage', '检查资料');
    service.store!.db.saveRun(run);
    await service.runner!.drive(run.id);
    const results = service.store!.db.run(run.id).messages.filter(message => message.role === 'tool');
    const message = (callId: string) => results.find(item => item.callId === callId)?.content ?? '';
    assert.match(message('missing'), /文件尚未创建/);
    assert.doesNotMatch(message('missing'), /文件有未确认外部变化/);
    assert.match(message('untracked'), /尚未纳入正式资料/);
    assert.match(message('external'), /文件有未确认外部变化/);
  } finally { await service.drain(); }
});

test('明显退化正文不能凭自评分通过；正常中文、短句复现和字数边界不误挡', () => {
  const p = newProject('正文检查', 'isolated', {});
  assert.equal(countWords(sampleProse()), 2500);
  assert.deepEqual(checkProse(prosePath(1), sampleProse(), p.config), []);
  const repetition = checkProse(prosePath(1), '# 正文\n' + '宁'.repeat(2500), p.config);
  assert.ok(repetition.some(issue => issue.code === 'prose_repetition'));
  const paragraph = '他沿着走廊走到楼梯口，停下来听门外的脚步。灯还亮着，桌上的纸却已经被人换过。他翻到最后一页，发现那里多了一枚手印。';
  assert.ok(checkProse(prosePath(1), Array(40).fill(paragraph).join('\n\n'), p.config).some(issue => issue.code === 'prose_duplicate_paragraphs'));
  const normal = sampleProse().replace('阿宁', '𠮷宁');
  assert.deepEqual(checkProse(prosePath(1), normal, p.config), []);
  const issues = validateCandidate('S10', p, [{ path: prosePath(1), content: '宁'.repeat(2500), baseHash: null }], skill);
  assert.ok(issues.some(issue => issue.code === 'prose_repetition' && issue.severity === 'error'));
});

test('正式导出挡住占位、未完成、待核对和磁盘未确认改动；完整正文可导出且不覆盖目标', async () => {
  const service = new Service(skill, () => {}, async () => fakeResult());
  const root = isolatedRoot('publication');
  try {
    await service.invoke('project.create', { parent: root, title: '投稿检查', premise: '维修员调查故障', config: {} });
    const file = prosePath(1), target = path.join(root, '正文.txt');
    await assert.rejects(service.invoke('project.export', { paths: [file], target }), /尚未准备好/);
    assert.ok(!fs.existsSync(target));
    const p = service.store!.db.project();
    service.store!.commit([service.change(file, sampleProse())], p);
    await assert.rejects(service.invoke('project.export', { paths: [file], target }), /尚未完成正文审阅/);
    p.chapters[1] = 'complete';
    p.stale = [file];
    assert.ok(checkPublication(p, [{ path: file, content: sampleProse() }]).some(issue => issue.code === 'publication_stale'));
    p.stale = [];
    service.store!.db.set('project', p);
    fs.appendFileSync(path.join(service.store!.root, file), '\n未经确认的改动');
    await assert.rejects(service.invoke('project.export', { paths: [file], target }), /外部变化/);
    fs.writeFileSync(path.join(service.store!.root, file), sampleProse());
    await service.invoke('project.export', { paths: [file, file], target });
    const exported = fs.readFileSync(target, 'utf8');
    assert.equal(exported.trim(), sampleProse().replace(/^# /, '').trim());
    await assert.rejects(service.invoke('project.export', { paths: [file], target }), /存在|覆盖/);
    assert.equal(fs.readFileSync(target, 'utf8'), exported);
    const noteTarget = path.join(root, '配置.md');
    await service.invoke('project.export', { paths: [paths.config], target: noteTarget });
    assert.ok(fs.existsSync(noteTarget));
  } finally { await service.drain(); }
});

test('审稿须绑定当前正文且五项引文可回查，问题结论不能被高分盖过', () => {
  const prose = sampleProse(), file = qualityPath(1);
  const value = { proseHash: hash(prose), checks: reviewAspects.map(aspect => ({ aspect, verdict: 'pass', quote: '阿宁推开诊室的门，把记录本递到灯下。', reason: '主角主动送交证据，推动医生作出接下来的选择。' })) };
  const report = () => '中文审阅结论。\n\n```json wenxu-review\n' + JSON.stringify(value) + '\n```\n';
  assert.deepEqual(checkReviewEvidence(file, report(), prose), []);
  assert.equal(documentPreviewText(report()), '中文审阅结论。');
  assert.ok(checkReviewEvidence(file, '总分：100/100', prose).some(issue => issue.code === 'review_evidence_missing'));
  assert.ok(checkReviewEvidence(file, report(), prose + '新增内容').some(issue => issue.code === 'review_evidence_stale'));
  value.checks[0].quote = '原文没有的桥段不能作为任何判断依据';
  assert.ok(checkReviewEvidence(file, report(), prose).some(issue => issue.code === 'review_evidence_quote'));
  value.checks[0].verdict = 'error';
  assert.ok(checkReviewEvidence(file, report(), prose).some(issue => issue.code === 'review_finding' && issue.severity === 'error'));
});

test('模型等待超时保留流式文字，不被误报成普通断流且不自动重发', async () => {
  let calls = 0, text = '';
  const server = http.createServer((_, res) => {
    calls++;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"type":"response.output_text.delta","delta":"已生成片段"}\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(invokeModel({ ...fakeProfile, protocol: 'responses', stream: true, timeoutSeconds: 0.25,
      baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` }, '', [], [], new AbortController().signal, delta => { text += delta; }), error => {
      assert.ok(error instanceof RequestError && error.uncertain);
      assert.match(error.message, /等待模型超过 0.25 秒/);
      assert.match(error.message, /不会自动重发/);
      return true;
    });
    assert.equal(text, '已生成片段');
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('HTTP 错误按实际类别解释，不暴露服务端响应或暗示已经自动重试', async () => {
  for (const [status, expected] of [[401, /API Key/], [429, /限流或额度/], [502, /服务或中转暂时异常/], [504, /等待超时/]] as const) {
    const server = http.createServer((_, res) => { res.writeHead(status); res.end('private-upstream-details'); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      await assert.rejects(invokeModel({ ...fakeProfile, baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1` }, '', [], [], new AbortController().signal), error => {
        assert.ok(error instanceof RequestError && error.uncertain);
        assert.match(error.message, expected);
        assert.doesNotMatch(error.message, /private-upstream/);
        return true;
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  }
});
