import fs from 'node:fs';
import { prepareEvaluationProfile } from './evaluation-profile';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { Service } from '../src/core/service';
import { batchPath, detailPath, hash, prosePath } from '../src/core/domain';
import { invokeModel } from '../src/core/provider';
import { readQuality, mutateQuality, storeLearnedPreferences, voiceDocument, voicePath } from '../src/core/quality';
import { manuscriptTarget } from '../src/shared/manuscript-edit';
import { profileSchema, type SecretProfile } from '../src/shared/types';

const live = process.env.STUDY_MODE === 'live';
const output = process.env.STUDY_OUTPUT!, old = process.env.STUDY_BASE!;
const families = [
  { genre: '东方玄幻＋规则怪谈', title: '守夜脉', hero: '岑渡', other: '许芍',
    premise: '宗门守夜人以吐纳修补山脉。夜钟一响，仍有灵息的人不得应声；应声者要替唤名的亡者守山。守夜弟子白日失去听觉，药师要保住所剩的药田。',
    goals: ['试出夜钟错认回声的条件，以一枚灵穴为代价带药师出殿。', '前夜封住的灵穴无法使用。药师主动暴露药田，以泥中回声辨别谁在叫名。', '亡者学会压住自己的回声。二人只得改动守脉传承，把代价分给愿意守夜的人。'] },
  { genre: '现实职业＋悬疑', title: '返工单', hero: '唐岑', other: '陈芮',
    premise: '夜班检修员检出一批报废轴承却发现签收单用的是自己的工号。班长要保住当夜的工资。车间只有纸质交接，无监控也无万能技术。',
    goals: ['截住第一班出厂货，被扣当班津贴。交接单多了一枚反向油印。', '上一班停工造成工资纠纷。班长交出旧手套，让检修员核对油印，却隐瞒了替人打卡。', '真签收人提前换班。二人选择交出自己的违规记录保住返工证据，留下待厂方处置的后果。'] }
];
const drySamples = ['她捻起对折的纸，把尖角对齐了才开口。', '他把满杯推回去，隔着桌边问了一句。', '她没有接那句话，伸手把椅子让出半个身位。'];
const selected: { statement: string; samples: string[] } = live
  ? JSON.parse(fs.readFileSync(process.env.STUDY_SAMPLES!, 'utf8').replace(/^\uFEFF/, ''))
  : { statement: '人物难以回答时，让手上的事先发生。', samples: drySamples };
assert.ok(typeof selected.statement === 'string' && selected.statement.trim().length > 0);
assert.ok(Array.isArray(selected.samples) && selected.samples.length === 3 && selected.samples.every(s => typeof s === 'string' && s.trim() && Array.from(s).length <= 600));
assert.equal(new Set(selected.samples).size, 3);
const fixtureSamples = selected.samples;
const arms = ['baseline', 'materials', 'characters', 'samples'] as const;
type Arm = typeof arms[number];
type Attempt = { arm: Arm; genre: string; chapter: number; status: string; requestHash: string; started: string; elapsedMs?: number; usage?: unknown; responseHash?: string };
const journal = path.join(output, 'attempts.json');
const attempts: Attempt[] = [];
function write(file: string, value: unknown) {
  const temp = file + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value, null, 2));
  fs.renameSync(temp, file);
}
function shuffled() {
  const order = [...arms];
  for (let last = order.length - 1; last > 0; last--) { const next = randomInt(last + 1); [order[last], order[next]] = [order[next], order[last]]; }
  return order;
}
async function configuredProfile(): Promise<SecretProfile> {
  if (!live) return { ...profileSchema.parse({ id: 'offline', name: '离线', protocol: 'chat', model: 'synthetic', baseUrl: 'http://127.0.0.1:1/v1', contextLimit: 100000, outputLimit: 4096 }), apiKey: 'offline-fixture' };
  const { app, safeStorage } = require('electron') as typeof import('electron');
  const installed = prepareEvaluationProfile(app);
  await app.whenReady();
  const settings = JSON.parse(fs.readFileSync(path.join(installed, 'settings.json'), 'utf8'));
  const db = new DatabaseSync(path.join(settings.recent[0].root, '.novelclient/state.sqlite'), { readOnly: true });
  let profileId: string;
  try { profileId = JSON.parse(String(db.prepare('SELECT value FROM kv WHERE key=?').get('project')!.value)).config.defaultProfileId; }
  finally { db.close(); }
  const saved = settings.profiles.find((p: any) => p.id === profileId);
  if (!saved?.enabled || !saved.encryptedKey) throw Error('当前默认模型未配置可用凭据');
  const { encryptedKey, ...publicFields } = saved;
  const profile = { ...publicFields, apiKey: safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')) };
  return profile;
}
function seedExpression(service: Service) {
  const store = service.store!, scope = { kind: 'book', target: '', sceneFunction: '对话' }, ids: string[] = [];
  for (const [i, after] of fixtureSamples.entries()) {
    const file = '试读资料/已确认表达' + (i + 1) + '.md', before = '他觉得场面有些尴尬。';
    store.commit([service.change(file, before)], store.db.project()); store.commit([service.change(file, after)], store.db.project());
    const span = (quote: string) => ({ path: file, hash: hash(quote), start: 0, end: Array.from(quote).length, quote });
    const state = mutateQuality(store, readQuality(store).revision, { kind: 'evidence', evidence: { before: span(before), after: span(after),
      scope, domain: 'expression', reason: selected.statement, editor: 'author' } });
    ids.push(state.evidence.at(-1)!.id);
  }
  storeLearnedPreferences(store, 'fixture-learning', [{ statement: selected.statement, scope, evidenceIds: ids, alternatives: [], exceptions: ['紧急处置时'] }]);
  store.commit([service.change(voicePath, voiceDocument(store, [readQuality(store).preferences.at(-1)!.id]))], store.db.project());
}
async function main() {
  // Exclusive even across processes. A failed or uncertain dispatch cannot be replayed by relaunching.
  fs.writeFileSync(path.join(output, 'started'), new Date().toISOString(), { flag: 'wx' });
  const p = await configuredProfile();
  const profile = { ...p, tools: false, networkRecovery: { ...p.networkRecovery, maxRetries: 0, retryUnknown: false } } as SecretProfile;
  const reader = path.join(output, 'reading'), projects = path.join(output, 'projects'), wires = path.join(output, 'requests');
  for (const dir of [reader, projects, wires]) fs.mkdirSync(dir, { recursive: true });
  write(path.join(output, 'conditions.json'), { mode: live ? 'live' : 'offline', baseline: process.env.STUDY_COMMIT, model: profile.model, outputLimit: profile.outputLimit, temperature: profile.temperature, inputPrice: profile.inputPrice, outputPrice: profile.outputPrice, families, expression: selected });
  const mapping = families.map(shuffled);
  write(path.join(output, 'key.json'), mapping);
  const index = [live ? '# 连续三章匿名试读' : '# 离线流程演示（合成占位正文）', '按题材阅读同一署名下的连续三章。每章独立记录反馈，可选都不想读或并列。'];
  const questions = '愿意继续读吗？在哪一章哪一段失去兴趣？记住了谁、因为什么选择？哪句对白出戏？需要重写多少字？设定、人物知情或前章承接有几处错误？请引用原句。';
  for (const [familyIndex, book] of families.entries()) {
    index.push('## ' + book.genre);
    for (const [aliasIndex, arm] of mapping[familyIndex].entries()) {
      const alias = String.fromCharCode(65 + aliasIndex), sample = ['# ' + book.title + ' · ' + alias], numbers = [1, 2, 3];
      const Constructor: typeof Service = arm === 'baseline' ? require(path.join(old, '../baseline.cjs')).Service : Service;
      let chapter = 0, previous = '', called = false;
      const service = new Constructor(arm === 'baseline' ? path.join(old, 'resources/skill') : path.resolve('resources/skill'), () => {}, async (cfg, originalSystem, messages, tools, signal, delta, options) => {
        if (called || attempts.some(a => a.status !== 'complete') || attempts.length >= 24) throw Error('同章已发出或先前结果未确认；终止');
        const marker = '\n当前任务资料包：', at = originalSystem.lastIndexOf(marker);
        assert.ok(at >= 0);
        const material = JSON.parse(originalSystem.slice(at + marker.length));
        let system = originalSystem;
        if (arm !== 'baseline') {
          assert.ok(material.writingMaterials.characters.some((c: any) => c.character === book.hero));
          if (arm === 'materials') delete material.writingMaterials.characters;
          if (chapter > 1) assert.ok(material.sources.some((s: any) => s.path === prosePath(chapter - 1) && s.hash === hash(previous)));
          if (arm === 'samples') assert.ok(material.voicePreferences?.some((v: any) => v.samples?.some((e: any) => fixtureSamples.includes(e.text))));
          if (arm !== 'samples') {
            for (const preference of material.voicePreferences ?? []) delete preference.samples;
            system = originalSystem.slice(0, at + marker.length) + JSON.stringify(material);
          }
        }
        if (arm !== 'samples') assert.ok(!fixtureSamples.some(s => system.includes(s)));
        assert.equal(tools.length, 0);
        const wire = { system, messages: structuredClone(messages), tools };
        const key = familyIndex + '-' + alias + '-' + chapter;
        write(path.join(wires, key + '.json'), wire);
        const event: Attempt = { arm, genre: book.genre, chapter, status: 'dispatched', requestHash: hash(JSON.stringify(wire)), started: new Date().toISOString() };
        called = true; attempts.push(event); write(journal, attempts);
        const start = Date.now();
        try {
          const synthetic = '第' + chapter + '章。' + book.goals[chapter - 1] + '（合成流程占位 ' + key + '）';
          const result = live ? await invokeModel(cfg, system, messages, tools, signal, delta, options) :
            { text: synthetic, calls: [], native: {}, usage: { input: 0, output: 0, cost: 0, currency: 'USD' }, stop: 'complete' as const };
          if (result.stop !== 'complete' || !result.text.trim() || result.calls.length) throw Error('未收到完整正文');
          Object.assign(event, { status: 'complete', usage: result.usage, responseHash: hash(result.text) }); return result;
        } catch (error) { event.status = 'failed_or_unknown'; throw error; }
        finally { event.elapsedMs = Date.now() - start; write(journal, attempts); }
      });
      service.profiles = [profile];
      try {
        await service.invoke('project.create', { parent: projects, title: book.title, premise: book.premise, config: { defaultProfileId: profile.id, genre: book.genre,
          constraints: book.premise, style: selected.statement, stageBudget: null, chapterWords: 1200, minWords: 900, maxWords: 1500 } });
        const store = service.store!, project = store.db.project(), outlines = book.goals.map((goal, i) => '## 第' + (i + 1) + '章\n' + goal);
        store.commit([service.change(batchPath(project.batches[0]), outlines.join('\n\n')), ...book.goals.map((goal, i) => service.change(detailPath(i + 1),
          '# 第' + (i + 1) + '章细纲\n' + goal + '\n## 场面1：交涉\n- 场景功能：对话\n- 焦点人物：' + book.hero + '\n- 交谈对象：' + book.other + '\n- 目标：' + goal + '\n- 对话意图：要求对方交出凭证。'))], project);
        if (arm !== 'baseline') seedExpression(service);
        for (chapter of numbers) {
          called = false;
          const chat = await service.invoke('chat.create', { title: '第' + chapter + '章' });
          const turn = await service.invoke('chat.send', { conversationId: chat.id, text: '按给定题材、当章安排及上章实际结尾，写第' + chapter + '章正文，约1200字。' + book.goals[chapter - 1], manuscript: manuscriptTarget(project.id, prosePath(chapter), '') });
          let reply = await service.invoke('chat.manuscript', { id: turn });
          while (reply.message.status === 'running') { await new Promise(resolve => setTimeout(resolve, live ? 300 : 15)); reply = await service.invoke('chat.manuscript', { id: turn }); }
          if (reply.message.status !== 'complete' || !called) throw Error([arm, chapter, reply.message.status, reply.message.content].join(' '));
          previous = reply.message.content;
          store.commit([service.change(prosePath(chapter), previous)], store.db.project());
          sample.push('## 第' + chapter + '章', previous);
        }
      } finally { await service.drain(); }
      const file = 'genre-' + (familyIndex + 1) + '-' + alias + '.md';
      fs.writeFileSync(path.join(reader, file), sample.join('\n\n') + '\n');
      index.push('[' + alias + ' 的三章](' + file + ')');
    }
  }
  assert.equal(attempts.length, 24);
  fs.writeFileSync(path.join(reader, 'index.md'), [...index, questions].join('\n\n') + '\n');
  console.log(live ? '真实试读 24/24；' + reader : '离线合成 24/24');
}
main().then(() => { if (live) require('electron').app.exit(0); }, error => {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
  if (live) require('electron').app.exit(1);
});
