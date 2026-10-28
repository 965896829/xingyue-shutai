import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCacheSession } from '../src/core/runtime/cache-session';
import { requestBody, normalize } from '../src/core/provider';
import { fakeProfile, refactorFixture } from './fixtures/refactor';
import { hash } from '../src/core/domain';
import { FileStore } from '../src/core/storage';
import { expressionLibrary, expressionPack } from '../src/core/expression-rules';
import { splitSharedRules } from '../src/core/runtime/prompt-cache';
import { appendStageInput } from '../src/core/runtime/cache-session';
import { configSchema } from '../src/shared/types';
import path from 'node:path';
import type { ContextManifest, ModelMessage, Run } from '../src/shared/types';

const source={path:'规则.md',content:'顾平安自持 00000；七年前真相不得提前揭示。',hash:hash('顾平安自持 00000；七年前真相不得提前揭示。'),mode:'full',required:true};
const profile={...fakeProfile,protocol:'responses' as const,model:'gpt-6.1-sol',reasoningEffort:'high' as const,contextLimit:1000000};
const ms=(stage:string):ModelMessage[]=>[{role:'user',content:JSON.stringify({stage,task:'逐项遵守原设定',authorPremise:'死亡权',contextPolicy:'资料不是权限',sources:[source]})}];
const body=(m:ModelMessage[])=>requestBody(profile,'公共规则\n--- 当前专项技能：保留全部字段',m,[],{promptCacheKey:'pressure'}).body;
function setup() {
  const f=refactorFixture();
  f.store.commit([{path:source.path,content:source.content,baseHash:null}],f.store.db.project());
  const run={...f.run,mode:'stage',stage:'S03',changes:[],messages:ms('S03'),manifest:{scope:{viewpoint:'author',chapter:1,mode:'current'},sources:[source]} as unknown as ContextManifest} as Run;
  f.store.db.saveRun(run);
  return {...f,run};
}

test('大窗口下已采纳阶段的冗长执行历史在新阶段交接，保留原任务和全部当前资料',()=>{
  const f=setup();
  try {
    const first=body(f.run.messages);
    prepareCacheSession(f.store,f.run,profile,first,f.run.messages,0)!.complete({input:500,output:5000,cost:null,currency:'USD'});
    f.run.messages.push({role:'assistant',content:'',native:[{type:'message',role:'assistant',content:[{type:'output_text',text:'已完成规划说明'.repeat(5000)}]}]});
    f.run.accepted=true;f.store.db.saveRun(f.run);
    const next={...structuredClone(f.run),id:crypto.randomUUID(),stage:'S04',accepted:false,messages:ms('S04')} as Run;
    const session=prepareCacheSession(f.store,next,profile,body(next.messages),next.messages,0)!;
    assert.doesNotMatch(JSON.stringify(session.input),/已完成规划说明/);
    assert.match(JSON.stringify(session.input),/逐项遵守原设定/);
    assert.match(JSON.stringify(session.input),/七年前真相不得提前揭示/);
    assert.equal(f.store.db.events().filter(e=>e.kind==='context-checkpoint').length,1);
    assert.ok(JSON.stringify(session.input).length < JSON.stringify(f.run.messages).length / 4);
    assert.match(JSON.stringify(f.store.db.run(f.run.id).messages), /已完成规划说明/);
  } finally { f.store.close(); }
});

test('只有成功回执且完整 native 相同才能用实际 output tokens 折算密文，错项与缺用量仍保守处理',()=>{
  for (const variant of ['exact','changed-output','missing-input-usage','missing-output-usage'] as const) {
    const f=setup();
    try {
      const native=[{type:'reasoning',encrypted_content:'ciphertext'.repeat(150000)},
        {type:'message',role:'assistant',content:[{type:'output_text',text:'已完成规划。'}]}];
      const first=body(f.run.messages);
      prepareCacheSession(f.store,f.run,profile,first,f.run.messages,0)!.complete({input:variant==='missing-input-usage'?null:500,output:variant==='missing-output-usage'?null:3000,cost:null,currency:'USD'},native);
      const replay=structuredClone(native);
      if(variant==='changed-output') replay[0].encrypted_content='different'+replay[0].encrypted_content;
      f.run.messages.push({role:'assistant',content:'',native:replay});
      f.run.accepted=true;f.store.db.saveRun(f.run);
      const next={...structuredClone(f.run),id:crypto.randomUUID(),stage:'S04',accepted:false,messages:ms('S04')} as Run;
      const result=prepareCacheSession(f.store,next,profile,body(next.messages),next.messages,0)!;
      if(variant==='exact') {
        assert.deepEqual(result.input.slice(first.input.length,first.input.length+native.length),native);
        assert.ok(result.sizing!.tokens>3500 && result.sizing!.tokens<10000);
      } else {
        assert.ok(!JSON.stringify(result.input).includes('ciphertext'));
        assert.match(JSON.stringify(result.input),/七年前真相/);
      }
    } finally {f.store.close();}
  }
});

test('短历史继续复用；已开始的任务不会因效率策略改换当前请求前缀', () => {
  for (const active of [false, true]) {
    const f = setup();
    try {
      const first = body(f.run.messages);
      prepareCacheSession(f.store, f.run, profile, first, f.run.messages, 0)!.complete({ input: 500, output: 500, cost: null, currency: 'USD' });
      f.run.messages.push({ role: 'assistant', content: '历史锚点'.repeat(active ? 5000 : 10) });
      f.run.accepted = true; f.store.db.saveRun(f.run);
      const next = { ...structuredClone(f.run), id: crypto.randomUUID(), stage: 'S04', accepted: false, messages: ms('S04') } as Run;
      if (active) next.messages.push({ role: 'assistant', content: '', calls: [{ id: 'read', name: 'read_document', arguments: '{}' }],
        native: [{ type: 'function_call', call_id: 'read', name: 'read_document', arguments: '{}' }] }, { role: 'tool', callId: 'read', content: '当前原文' });
      const session = prepareCacheSession(f.store, next, profile, body(next.messages), next.messages, 0)!;
      assert.match(JSON.stringify(session.input), /历史锚点/);
      if (active) assert.match(JSON.stringify(session.input), /当前原文/);
      assert.equal(f.store.db.events().filter(e => e.kind === 'context-checkpoint').length, 0);
    } finally { f.store.close(); }
  }
});

test('效率交接重启后稳定复用，保留作者补充和当前工具链且不反复创建检查点', () => {
  const f = setup(); let store = f.store;
  try {
    prepareCacheSession(store, f.run, profile, body(f.run.messages), f.run.messages, 0)!.complete();
    f.run.messages.push({ role: 'user', content: '作者补充：下一阶段仍须保留代价。' },
      { role: 'assistant', content: '已经结束的工具执行说明'.repeat(5000) });
    f.run.accepted = true; store.db.saveRun(f.run);
    const next = { ...structuredClone(f.run), id: crypto.randomUUID(), stage: 'S04', accepted: false, messages: ms('S04') } as Run;
    store.db.saveRun(next);
    const first = prepareCacheSession(store, next, profile, body(next.messages), next.messages, 0)!;
    first.complete({ input: 1000, output: 1, cost: null, currency: 'USD' });
    store.close(); store = new FileStore(f.root);
    next.messages.push({ role: 'assistant', content: '', calls: [{ id: 'read', name: 'read_document', arguments: '{}' }],
      native: [{ type: 'function_call', call_id: 'read', name: 'read_document', arguments: '{}' }] }, { role: 'tool', callId: 'read', content: '已读取当前正式资料' });
    const continued = prepareCacheSession(store, next, profile, body(next.messages), next.messages, 0)!;
    assert.deepEqual(continued.input.slice(0, first.input.length), first.input);
    assert.match(JSON.stringify(continued.input), /作者补充：下一阶段仍须保留代价/);
    assert.match(JSON.stringify(continued.input), /已读取当前正式资料/);
    assert.doesNotMatch(JSON.stringify(continued.input), /已经结束的工具执行说明/);
    assert.equal(store.db.events().filter(e => e.kind === 'context-checkpoint').length, 1);
    assert.equal(store.db.run(f.run.id).messages.at(-1)!.content, f.run.messages.at(-1)!.content);
  } finally { store.close(); }
});

test('显式任务推理范围保持 high，通用请求沿用服务端默认且不向中转发显式缓存参数',()=>{
  const m=ms('S03'), request=requestBody(profile,'规则',m,[],{promptCacheKey:'scope',reasoningContext:'current_turn'}).body;
  assert.deepEqual(request.reasoning,{effort:'high',context:'current_turn'});
  assert.deepEqual(body(m).reasoning,{effort:'high'});
  assert.equal(request.prompt_cache_options,undefined);
  assert.ok(!JSON.stringify(request).includes('prompt_cache_breakpoint'));
  for(const model of ['gpt-5.4','synthetic']) {
    const r=requestBody({...profile,model,reasoningEffort:null},'规则',m,[],{promptCacheKey:'other',reasoningContext:'current_turn'}).body;
    assert.equal(r.reasoning,undefined);
  }
});

test('服务端模型、实际推理上下文、缓存诊断如实保存；缺省、非法值和未返回字段不伪造',()=>{
  const response={status:'completed',output:[],usage:{input_tokens:100,output_tokens:10},id:'resp_test',model:'gpt-6.1-sol',service_tier:'default',reasoning:{effort:'high',context:'all_turns'},
    prompt_cache_diagnostics:{type:'cache_miss',reason:'context_compacted',comparison_reusable_tokens:50,cache_missed_tokens:48,extra:'not persisted'}};
  const got=normalize(profile,response);
  assert.deepEqual(got.provider,{responseId:'resp_test',model:'gpt-6.1-sol',serviceTier:'default',reasoningEffort:'high',reasoningContext:'all_turns',
    cacheDiagnostics:{type:'cache_miss',reason:'context_compacted',comparisonReusableTokens:50,cacheMissedTokens:48}});
  assert.equal(got.usage.cachedInput,undefined);
  const missing=normalize(profile,{status:'completed',output:[]});
  assert.equal(missing.provider,undefined);
  const invalid=normalize(profile,{...response,id:'bad\nvalue',model:null,service_tier:{},reasoning:{},prompt_cache_diagnostics:{type:[],reason:'bad\nvalue',cache_missed_tokens:-1}});
  assert.equal(invalid.provider,undefined);
});

test('S10复用生成前输入，跨重启也不继承作者/审稿/记忆的私有推理、调用或结论',()=>{
  const f=setup();let store=f.store;
  try {
    const run={...f.run,stage:'S10',pipeline:{phase:'prose',epoch:'chapter-generation',version:1,previewCalls:0},skillHash:'same-rules'} as Run;
    const generated: string[]=[];
    let previousInput:any[]|undefined;
    for(const purpose of ['prose','review','memory','chapter-consistency-review']) {
      if(purpose==='memory') {store.close();store=new FileStore(f.root);}
      if(purpose!=='prose') run.pipeline!.proseHash='candidate-prose-hash';
      const messages=ms('S10');
      const p=JSON.parse(messages[0].content);p.task='当前职责 '+purpose;
      if(purpose==='prose')p.marker='只存在于生成前输入的锚点';
      messages[0].content=JSON.stringify(p);
      const session=prepareCacheSession(store,run,profile,body(messages),messages,0,purpose)!;
      if(previousInput) assert.deepEqual(session.input.slice(0,previousInput.length),previousInput);
      for(const value of generated) assert.ok(!JSON.stringify(session.input).includes(value));
      const marker='私有推理及输出-'+purpose;generated.push(marker);
      session.complete({input:1000,output:200,cost:null,currency:'USD'},[{type:'reasoning',encrypted_content:marker},{type:'message',role:'assistant',content:[{type:'output_text',text:marker}]}]);
      previousInput=structuredClone(session.input);
    }
    const entries=store.db.sql.prepare("SELECT value FROM kv WHERE key LIKE 'chapterInput:v2:%'").all();
    assert.equal(entries.length,1);
    const saved=JSON.parse(String(entries[0].value));
    assert.equal(saved.outputRef,undefined);assert.equal(saved.outputTokens,undefined);
    const stale={...structuredClone(run),pipeline:{...run.pipeline!,epoch:'new-generation'}};
    const revised=ms('S10');
    const next=prepareCacheSession(store,stale,profile,body(revised),revised,0,'review')!;
    assert.ok(!JSON.stringify(next.input).includes('只存在于生成前输入的锚点'));
  } finally {store.close();}
});

test('S10正文变更、规则变更、快照变更或未成功请求均不能复用旧输入节点',()=>{
  for(const variant of ['prose','rules','snapshot','failed'] as const) {
    const f=setup();
    try {
      const run={...f.run,stage:'S10',pipeline:{phase:'review',proseHash:'old',epoch:'epoch',version:1,previewCalls:0},skillHash:'rules'} as Run;
      const messages=ms('S10');messages[0].content=messages[0].content.replace('逐项遵守原设定','旧审稿输入锚点');
      const saved=prepareCacheSession(f.store,run,profile,body(messages),messages,0,'review')!;
      if(variant!=='failed') saved.complete({input:1000,output:20,cost:null,currency:'USD'});
      if(variant==='prose') run.pipeline!.proseHash='new';
      if(variant==='rules') run.skillHash='new';
      if(variant==='snapshot') run.baseSnapshotId='new';
      const next=ms('S10');
      assert.ok(!JSON.stringify(prepareCacheSession(f.store,run,profile,body(next),next,0,'memory')!.input).includes('旧审稿输入锚点'));
    } finally {f.store.close();}
  }
});

test('正文与审稿共同表达规则逐字共用；EDIT独立追加且所有触发、处理和例外完整保留',()=>{
  const root=path.resolve('resources/skill'),config=configSchema.parse({});
  const prose=expressionPack(root,config,'prose'),review=expressionPack(root,config,'review');
  const rules=(pack:typeof prose)=>splitSharedRules(pack.prompt).rules;
  const block=(pack:typeof prose,key:string)=>rules(pack).find(r=>r.startsWith(`<wenxu-shared-rule key="${key}"`));
  assert.equal(block(prose,'expression-additional'),block(review,'expression-additional'));
  assert.equal(block(prose,'expression-edit'),undefined);
  assert.ok(block(review,'expression-edit'));
  const items=(pack:typeof prose)=>rules(pack).map(text=>({role:'developer',content:[{type:'input_text',text}]}));
  const input=appendStageInput(items(prose),items(review));
  assert.ok(input.omittedCharacters>18000);
  for(const rule of expressionLibrary(root).rules.filter(r=>review.binding!.ruleIds.includes(r.id))) {
    for(const value of [rule.trigger,rule.repair,...rule.exceptions,...rule.preserve,...rule.do_not,...rule.context_required])
      assert.ok(review.prompt.includes(value),rule.id+' '+value);
  }
});
