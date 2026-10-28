import test from 'node:test';
import assert from 'node:assert/strict';
import { contextHandoff, currentContextCheckpoint } from '../src/core/runtime/context-checkpoint';
import { prepareCacheSession } from '../src/core/runtime/cache-session';
import { requestBody } from '../src/core/provider';
import { hash } from '../src/core/domain';
import { fakeProfile, refactorFixture } from './fixtures/refactor';
import { FileStore } from '../src/core/storage';
import type { Run, ModelMessage, ContextManifest } from '../src/shared/types';

const profile = { ...fakeProfile, protocol: 'responses' as const, model: 'gpt-6.1-sol', contextLimit: 1000000 };
const system = '公共约束\n--- 当前专项技能：按原模板完成';
const options = { promptCacheKey: 'handoff-test' };
const source = { path: '规则.md', content: '00000 号属于顾平安；七年前死亡是待解之谜，不是人物已知。', mode: 'full', required: true, category: 'author_instruction', hash: '' };
source.hash = hash(source.content);
function messages(stage = 'S08'): ModelMessage[] {
  return [{ role: 'user', content: JSON.stringify({ stage, task: '保留前三章承诺，不得提前揭示终局。', authorPremise: '死亡权原设定', contextPolicy: '计划不是事实',
    sources: [source], context_manifest: { snapshotId: 'v1', sources: [{ path: source.path, hash: source.hash, mode: source.mode, required: true }] },
    documentDrafts: [{ path: '细纲.md', draftHash: hash('前十章'), completedChapters: Array.from({length:10},(_,i)=>i+1), final: false }],
    facts: [{ value: '母女交易尚未发生', state: 'planned' }], revelation: { withheld: ['七年前真相'] }, prose: { content: '待审原文。', hash: hash('待审原文。') }
  }) }];
}
const body = (ms: ModelMessage[]) => requestBody(profile, system, ms, [], options).body;
const fresh = (ms: ModelMessage[]) => body(ms).input;
const noHandoff = { version: 1 as const, acceptedTasks: [] };

test('交接保留当前任务全部设定、证据、草稿范围和完整 native 工具链', () => {
  const ms = messages();
  ms.push({ role: 'assistant', content: '', calls: [{id:'write',name:'propose_changes',arguments:'{}'}], native: [
    {type:'reasoning',encrypted_content:'current-reasoning-must-remain'},
    {type:'function_call',call_id:'write',name:'propose_changes',arguments:'{"draftHash":"current","append":true}'}
  ] }, {role:'tool',callId:'write',content:'{"saved":true,"final":false,"completedChapters":[1,2,3,4,5,6,7,8,9,10]}'});
  const input = fresh(ms), result = currentContextCheckpoint(input, ms, noHandoff)!;
  assert.deepEqual(result.input, input);
  assert.equal(result.requiredSourceCount, 1);
  assert.equal(result.bindings[0].contentHash, source.hash);
  assert.match(JSON.stringify(result.input), /current-reasoning-must-remain/);
  assert.match(JSON.stringify(result.input), /completedChapters/);
});

test('缺底稿、错误 hash、来源元数据或审稿/事实字段被改动时不允许压缩', () => {
  const ms = messages(), base = fresh(ms);
  for (const kind of ['missing-source','source-content','source-role','source-ref','manifest','facts','prose','premise'] as const) {
    let input = structuredClone(base);
    const parse = (x: any) => { try { return JSON.parse(typeof x.content==='string'?x.content:x.content?.[0]?.text); } catch { return {}; } };
    const write = (x: any, p: any) => { if(typeof x.content==='string') x.content=JSON.stringify(p); else x.content[0].text=JSON.stringify(p); };
    if (kind==='missing-source') input=input.filter((x:any)=>!parse(x).source);
    else {
      const i = input.findIndex((x:any)=> kind.startsWith('source-')&&kind!=='source-ref'?parse(x).source:kind==='premise'?Object.hasOwn(parse(x),'authorPremise'):parse(x).contextPolicy);
      const p=parse(input[i]);
      if(kind==='source-content') p.source.content='错误原文';
      if(kind==='source-role') input[i].role='developer';
      if(kind==='source-ref') p.sources[0].required=false;
      if(kind==='manifest') p.context_manifest.snapshotId='wrong';
      if(kind==='facts') p.facts[0].state='actual';
      if(kind==='prose') p.prose.content='摘要代替原文';
      if(kind==='premise') p.authorPremise='新设定';
      write(input[i],p);
    }
    assert.equal(currentContextCheckpoint(input,ms,noHandoff),undefined,kind);
  }
});

test('未闭合和重复工具调用不在压缩边界被剪断', () => {
  const ms=messages();
  ms.push({role:'assistant',content:'',native:[{type:'function_call',call_id:'a',name:'read_document',arguments:'{}'}]});
  assert.equal(currentContextCheckpoint(fresh(ms),ms,noHandoff),undefined);
  ms.push({role:'tool',callId:'a',content:'原文'});
  assert.ok(currentContextCheckpoint(fresh(ms),ms,noHandoff));
  ms.push({role:'tool',callId:'a',content:'重复回执'});
  assert.equal(currentContextCheckpoint(fresh(ms),ms,noHandoff),undefined);
});

test('已采纳阶段要求和补充原文跨多次交接保留且不变成 developer 指令', () => {
  const prefix=fresh(messages('S07'));
  prefix.push({role:'user',content:'作者补充：顾平安仍然是事故调查员。'});
  const handoff=contextHandoff(prefix);
  const result=currentContextCheckpoint(fresh(messages()),messages(),handoff)!;
  assert.equal(handoff.acceptedTasks[0].stage,'S07');
  assert.equal(handoff.notes?.[0].content,'作者补充：顾平安仍然是事故调查员。');
  assert.ok(result.input.some(i=>i.role==='user'&&JSON.stringify(i).includes('contextCheckpoint')));
  const next=contextHandoff(result.input);
  assert.equal(next.notes?.length,1);
  assert.equal(next.acceptedTasks.length,2);
});

test('已关闭历史产生容量压力才本地交接，重启后当前阶段继续追加且只创建一个检查点', () => {
  const f=refactorFixture();
  f.store.commit([{path:source.path,content:source.content,baseHash:null}],f.store.db.project());
  f.run.mode='stage'; f.run.stage='S07'; f.run.messages=messages('S07'); f.run.changes=[];
  f.run.manifest={scope:{viewpoint:'author',chapter:1,mode:'current'},sources:[source]} as unknown as ContextManifest;
  f.store.db.saveRun(f.run);
  prepareCacheSession(f.store,f.run,profile,body(f.run.messages),f.run.messages,0)!.complete();
  f.run.messages.push({role:'assistant',content:'',native:[{type:'reasoning',encrypted_content:'closed-planning-reasoning'.repeat(10000)},
    {type:'message',role:'assistant',content:[{type:'output_text',text:'已关闭的阶段执行说明。'.repeat(5000)}]}]});
  f.run.accepted=true; f.store.db.saveRun(f.run);
  const next={...structuredClone(f.run),id:crypto.randomUUID(),stage:'S08',accepted:false,messages:messages()} as Run;
  f.store.db.saveRun(next);
  const before=JSON.stringify(f.run.messages);
  const constrained={...profile,contextPolicy:{tokenizer:'conservative' as const,effectiveInputLimit:100000,providerOverhead:0,safetyRatio:0.01,safetyTokens:64,toolResultReserve:0}};
  const session=prepareCacheSession(f.store,next,constrained,body(next.messages),next.messages,0)!;
  session.complete({input:600,output:1,cost:null,currency:'USD'});
  assert.equal(next.contextCompactions?.length, 1);
  assert.equal(next.contextCompactions?.[0].kind, 'stage_handoff');
  assert.ok(next.contextCompactions![0].beforeBytes > next.contextCompactions![0].afterBytes);
  assert.ok(!JSON.stringify(session.input).includes('closed-planning-reasoning'));
  assert.equal(JSON.stringify(f.run.messages),before);
  const first=structuredClone(session.input);
  f.store.close();
  const reopened=new FileStore(f.root);
  try {
    next.messages.push({role:'assistant',content:'',native:[{type:'function_call',call_id:'save',name:'propose_changes',arguments:'{}'}]}, {role:'tool',callId:'save',content:'草稿前十章已保存'});
    const continued=prepareCacheSession(reopened,next,constrained,body(next.messages),next.messages,0)!;
    assert.deepEqual(continued.input.slice(0,first.length),first);
    assert.deepEqual(continued.input.slice(-2),fresh(next.messages).slice(-2));
    assert.equal(reopened.db.events().filter(e=>e.kind==='context-checkpoint').length,1);
    assert.equal(next.contextCompactions?.length, 1, '续轮不得重复显示同一次压缩');
    assert.ok(continued.sizing!.tokens<JSON.stringify(continued.input).length);
    assert.match(JSON.stringify(continued.input),/前十章已保存/);
  } finally {reopened.close();}
});
