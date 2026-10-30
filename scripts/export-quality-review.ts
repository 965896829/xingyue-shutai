import { renderReviewPage } from '../src/shared/review-page';
import { registerReviewPacket } from '../src/core/blind-review';
import fs from 'node:fs';
import path from 'node:path';
import { FileStore } from '../src/core/storage';
import { Conversations } from '../src/core/conversations';
import { readQuality } from '../src/core/quality';
import { hash, countWords } from '../src/core/domain';

const evidence = path.resolve('.test-output/xingyue-v7/live-quality');
const output = path.resolve('output/xingyue-v7');
fs.mkdirSync(output, { recursive: true });
const completion = JSON.parse(fs.readFileSync(path.join(evidence, 'completion.json'), 'utf8'));
const budget = JSON.parse(fs.readFileSync(path.join(evidence, 'budget.json'), 'utf8'));
const records = JSON.parse(fs.readFileSync(path.join(evidence, 'results.json'), 'utf8'));
const store = new FileStore(completion.projectRoot);
try {
  const state = readQuality(store), conversations = new Conversations(store);
  const cases = state.experiments.map((experiment, index) => ({
    id: hash(experiment.id).slice(0, 24), title: `场景 ${String(index + 1).padStart(2, '0')}`,
    questions: ['更愿意继续阅读哪一篇？', '最想知道的下一件事是什么？', '人物选择是否可信？哪里难懂或无聊？'],
    candidates: experiment.candidates.map(candidate => {
      const run = store.db.run(candidate.runId);
      const text = run.creative?.result?.draftId ? conversations.readDraft(run.creative.result.draftId).content : candidate.text;
      return { text, hash: hash(text) };
    })
  }));
  const packetId = hash(JSON.stringify(cases));
  const mappingPath = path.join(evidence, 'blind-private-mapping.json');
  const priorMapping = fs.existsSync(mappingPath) ? JSON.parse(fs.readFileSync(mappingPath, 'utf8')) : undefined;
  const createdAt = priorMapping?.packetId === packetId ? priorMapping.createdAt : new Date().toISOString();
  const privateMapping = { packetId, projectRoot: store.root, createdAt, cases: cases.map((c, i) => ({ publicId: c.id, experiment: state.experiments[i], displayedHashes: c.candidates.map(s => s.hash), codePoints: c.candidates.map(s => Array.from(s.text).length), wordCounts: c.candidates.map(s => countWords(s.text)) })) };
  fs.writeFileSync(path.join(evidence, 'blind-private-mapping.json'), JSON.stringify(privateMapping, null, 2));
  registerReviewPacket(store, cases.map((c, index) => ({ ...c, experimentId: state.experiments[index].id, candidates: c.candidates.map((v, candidate) => ({ ...v, candidateId: state.experiments[index].candidates[candidate].id })) })), createdAt);
  const html = renderReviewPage({ packetId, cases });
  fs.writeFileSync(path.join(output, 'anonymous-review.html'), html);
  const attempts = budget.attempts as { status: string; elapsedMs: number; usage?: Record<string, number | null> }[];
  const summary = {
    recordedAt: new Date().toISOString(), model: JSON.parse(fs.readFileSync(path.join(evidence, 'configuration.json'), 'utf8')),
    authorizedCalls: budget.authorized, dispatchedCalls: budget.dispatched, requestOutcomes: Object.fromEntries([...new Set(attempts.map(a=>a.status))].map(status=>[status,attempts.filter(a=>a.status===status).length])),
    tokens: Object.fromEntries(['input','output','cachedInput','reasoningOutput'].map(key=>[key,attempts.reduce((sum,a)=>sum+Number(a.usage?.[key]??0),0)])),
    monetaryCost: null, costReason: '供应方未返回实际价格，不将未知费用计作零。',
    requestMs: { min: Math.min(...attempts.map(a=>a.elapsedMs)), median: attempts.map(a=>a.elapsedMs).sort((a,b)=>a-b)[Math.floor(attempts.length/2)], max: Math.max(...attempts.map(a=>a.elapsedMs)), sum: attempts.reduce((n,a)=>n+a.elapsedMs,0) },
    anonymousPacket: { packetId, pairs: cases.length, development: state.experiments.filter(e=>e.stage==='development').length, holdout: state.experiments.filter(e=>e.stage==='holdout').length, preregistered: state.experiments.filter(e=>e.preregistered).length, humanReaders: 0, status: 'awaiting_human_review' },
    uniqueTasks: new Set(records.map((r: {runId:string})=>r.runId)).size,
    records: records.map((r: {label:string;runId:string;status:string;error?:string})=>({label:r.label,runId:r.runId,status:r.status,error:r.error??''})),
    lengths: privateMapping.cases.map(c=>({publicId:c.publicId,stage:c.experiment.stage,codePoints:c.codePoints,wordCounts:c.wordCounts,target:[250,400],outsideTarget:c.wordCounts.some(n=>n<250||n>400)})),
    atomicProof: JSON.parse(fs.readFileSync(path.join(evidence,'atomic-commit-proof.json'),'utf8')),
    limitations: ['开发样稿是生成后登记，不能作为预登记实验结果。', '短场景与五章续写使用合成题材；不能推出百万字真实小说质量。', '读者尚未提交真人反馈；不能报告偏好胜率。', '模型服务未提供不可变模型版本或随机种子。']
  };
  fs.writeFileSync(path.join(output, 'evaluation-report.json'), JSON.stringify(summary,null,2));
  console.log(JSON.stringify({output,calls:budget.dispatched,pairs:cases.length,humanReaders:0}));
} finally { store.close(); }
