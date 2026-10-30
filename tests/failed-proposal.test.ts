import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { AgentRunner } from '../src/core/runner';
import { loadNamingRules } from '../src/core/naming';
import { hash, prosePath } from '../src/core/domain';
import { FileStore } from '../src/core/storage';
import { materializeChanges } from '../src/core/runtime/source-reuse';
import { reuseFailedChanges } from '../src/core/runtime/failed-proposal';
import { requiredCharacterCoverage } from '../src/core/chapter-memory';
import type { ChapterCoverage } from '../src/shared/chapter-memory';
import { fakeProfile, refactorFixture } from './fixtures/refactor';
import type { Run } from '../src/shared/types';
const sample=JSON.parse(fs.readFileSync('tests/fixtures/death-right-059-rejected-facts.json','utf8'));
const skill=path.resolve('resources/skill');
function fixture(){
 const f=refactorFixture();
 f.store.commit(sample.sources.map((s:any)=>({path:s.path,content:s.content,baseHash:null})),f.store.db.project());
 const run={...f.run,mode:'stage',stage:'S10',skillId:'webnovel-memory-extractor',chapter:1,
  baseRevision:f.store.db.project().revision,baseSnapshotId:f.store.db.get('headSnapshot'),
  pipeline:{phase:'memory',epoch:'epoch1',proseHash:hash(sample.prose),version:1,previewCalls:0},
  changes:[{path:prosePath(1),content:sample.prose,baseHash:null}],facts:[],messages:[]} as Run;
 f.store.db.saveRun(run);return {...f,run};
}
async function submit(store:FileStore,run:Run,args:unknown){
 const runner=new AgentRunner(store,skill,()=>[fakeProfile],()=>{});
 await (runner as any).execute(run,store.db.project(),{id:crypto.randomUUID(),name:'propose_changes',arguments:JSON.stringify(args)},new AbortController().signal,loadNamingRules(skill));
 return JSON.parse(run.messages.at(-1)!.content);
}
test('0.4.59真实错误原子拒绝，跨重启仅重交事实可复用五个补丁，无需读取或改正式文件',async()=>{
 const f=fixture();let store=f.store;
 try{
  const before=structuredClone(f.run),expected=materializeChanges(store,f.run,store.db.project(),sample.changes);
  const error=await submit(store,f.run,{changes:sample.changes,facts:[sample.badFact],complete:true});
  assert.match(error.error,/事件依据必须来自正文/);assert.equal(error.saved,false);assert.equal(error.candidateWrites,'none');assert.equal(error.versions.length,5);
  assert.deepEqual(f.run.changes,before.changes);assert.deepEqual(f.run.facts,before.facts);
  assert.deepEqual(f.run.candidateWrites,before.candidateWrites);
  for(const s of sample.sources)assert.equal(store.read(s.path).hash,s.hash);
  const id=f.run.id;store.close();store=new FileStore(f.root);const restored=store.db.run(id);
  const result=await submit(store,restored,{changes:[],reuseChangesFrom:error.reuseChangesFrom,facts:[sample.correctedFact],complete:true});
  assert.equal(result.error,undefined);assert.equal(result.saved,true);assert.equal(result.extractionComplete,true);
  for(const c of expected)assert.equal(restored.changes.find(x=>x.path===c.path)?.content,c.content);
  assert.equal(restored.facts.length,1);assert.equal(restored.facts[0].evidence.length,1);
  assert.equal(restored.facts[0].evidence[0].path,prosePath(1));
  assert.equal(restored.facts[0].reviewStatus,'candidate');
  for(const s of sample.sources)assert.equal(store.read(s.path).hash,s.hash);
  assert.throws(()=>reuseFailedChanges(store,restored,error.reuseChangesFrom),/失效/);
 }finally{store.close();}
});
test('失败批次复用仍拒绝错任务、错epoch、候选改动、事实错误及外部文件改动',async()=>{
 const f=fixture();try{
  const error=await submit(f.store,f.run,{changes:sample.changes,facts:[sample.badFact],complete:true});
  for(const changed of [{...f.run,id:crypto.randomUUID()}, {...f.run,pipeline:{...f.run.pipeline!,epoch:'different'}},
   {...f.run,changes:[...f.run.changes,{path:'other.md',baseHash:null,content:'changed'}]}] as Run[])
    assert.throws(()=>reuseFailedChanges(f.store,changed,error.reuseChangesFrom),/失效/);
  const bad=await submit(f.store,f.run,{changes:[],reuseChangesFrom:error.reuseChangesFrom,facts:[sample.badFact],complete:true});
  assert.match(bad.error,/事件依据必须来自正文/);assert.equal(f.run.changes.length,1);
  const s=sample.sources[0];fs.appendFileSync(path.join(f.root,s.path),'\n外部修改');
  const stale=await submit(f.store,f.run,{changes:[],reuseChangesFrom:bad.reuseChangesFrom,facts:[sample.correctedFact],complete:true});
  assert.match(stale.error,/版本|改动/);assert.equal(f.run.changes.length,1);assert.equal(f.run.facts.length,0);
 }finally{f.store.close();}
});

for (const invalid of ['missing', 'malformed', 'unlinked', 'null'] as const)
test(`人物覆盖 ${invalid} 时保留原子拒绝回执，重启后修正覆盖可复用全部文件`, async () => {
  const f = fixture(); let store = f.store;
  try {
    f.run.pipeline!.coverageVersion = 1;
    store.db.saveRun(f.run);
    const quote = '顾平安看见刀的时候', start = Array.from(sample.prose.slice(0, sample.prose.indexOf(quote))).length;
    const coverage: ChapterCoverage = {
      schemaVersion: 1, proseHash: hash(sample.prose),
      characters: [
        ...requiredCharacterCoverage(store, f.run).filter(c => c.entityId !== 'C001').map(c => ({
          ...c, outcome: 'insufficient_evidence' as const, reason: '本夹具未提交此人物变化。', factIds: [],
          evidence: [{ quote, start, end: start + Array.from(quote).length }]
        })),
        { entityId: 'C001', name: '顾平安', outcome: 'changed', reason: '本章遭到持刀攻击。',
          factIds: [sample.correctedFact.id], evidence: [{ quote, start, end: start + Array.from(quote).length }] }
      ]
    };
    const broken = invalid === 'missing' ? undefined : invalid === 'malformed' ? {} : invalid === 'null' ? null : {
      ...coverage, characters: coverage.characters.map(c => ({ ...c, outcome: 'changed', factIds: [] }))
    };
    const before = structuredClone(f.run), expected = materializeChanges(store, f.run, store.db.project(), sample.changes);
    const failed = await submit(store, f.run, { changes: sample.changes, facts: [sample.correctedFact], coverage: broken, complete: true });
    assert.match(failed.error, /人物|覆盖/);
    assert.doesNotMatch(failed.error, /expected object|undefined|ZodError/);
    assert.equal(failed.saved, false); assert.equal(failed.candidateWrites, 'none');
    assert.ok(failed.reuseChangesFrom); assert.match(failed.next, /coverage/);
    assert.deepEqual(f.run.changes, before.changes); assert.deepEqual(f.run.facts, before.facts);
    assert.deepEqual(f.run.chapterCoverage, before.chapterCoverage); assert.deepEqual(f.run.candidateWrites, before.candidateWrites);
    store.close(); store = new FileStore(f.root);
    const restored = store.db.run(f.run.id);
    const result = await submit(store, restored, { changes: [], reuseChangesFrom: failed.reuseChangesFrom,
      facts: [sample.correctedFact], coverage, complete: true });
    assert.equal(result.error, undefined); assert.equal(result.saved, true); assert.equal(result.extractionComplete, true);
    for (const change of expected) assert.equal(restored.changes.find(c => c.path === change.path)?.content, change.content);
    assert.deepEqual(restored.chapterCoverage, coverage); assert.equal(restored.facts.length, 1);
    assert.equal(restored.facts[0].reviewStatus, 'candidate'); assert.equal(restored.accepted, false);
    for (const source of sample.sources) assert.equal(store.read(source.path).hash, source.hash);
    assert.throws(() => reuseFailedChanges(store, restored, failed.reuseChangesFrom), /失效/);
  } finally { store.close(); }
});

test('人物覆盖格式延后校验不放行非法文件参数、过期来源或越权路径', async () => {
  const f = fixture();
  try {
    f.run.pipeline!.coverageVersion = 1;
    const before = structuredClone(f.run);
    for (const changes of [
      'invalid',
      [{ path: 'outside.md', content: '# 不允许的文件', baseHash: null }],
      [{ path: sample.sources[0].path, content: '# 过期版本', baseHash: 'a'.repeat(64) }]
    ]) {
      const result = await submit(f.store, f.run, { changes, facts: [sample.correctedFact], coverage: {}, complete: true });
      assert.ok(result.error); assert.equal(result.reuseChangesFrom, undefined);
      assert.deepEqual(f.run.changes, before.changes); assert.deepEqual(f.run.facts, before.facts);
    }
  } finally { f.store.close(); }
});
