import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { Service } from '../../src/core/service';
import { tagBundle } from '../../src/core/tags';
import { paths, stageOutputs } from '../../src/core/domain';
import { emptyTagInput } from '../../src/shared/tags';
import { fixture } from '../../tests/fixtures/workflow';

const sample = process.argv[2] ?? 'trial';
if (!/^[a-z-]+$/.test(sample)) throw new Error('Invalid sample');
const base = path.resolve('.test-output/newbook-20261011');
const settings = path.join(base, sample + '-profile');
const root = path.resolve('resources/skill');
const currentProject = () => {
  const projectRoot = JSON.parse(fs.readFileSync(path.join(settings, 'settings.json'), 'utf8')).recent[0].root;
  if (!path.resolve(projectRoot).startsWith(base + path.sep)) throw new Error('Only isolated projects allowed');
  const db = new DatabaseSync(path.join(projectRoot, '.novelclient/state.sqlite'), { readOnly: true });
  try { return JSON.parse((db.prepare('SELECT value FROM kv WHERE key = ?').get('project') as any).value); }
  finally { db.close(); }
};
const requests: unknown[] = [];
const result = (name: string, value: unknown) => ({ role: 'assistant', content: '本地模拟结果已准备好', tool_calls: [{ id: crypto.randomUUID(), type: 'function', function: { name, arguments: JSON.stringify(value) } }] });
const server = http.createServer(async (req, res) => {
  if (req.url === '/metrics') { res.end(JSON.stringify(requests)); return; }
  try {
    let body = '';
    for await (const part of req) body += part;
    const request = JSON.parse(body), name = request.tools[0].function.name;
    const project = currentProject();
    const stageContent = Object.fromEntries(['S01', 'S02', 'S03'].map(stage => [stage, Object.fromEntries(stageOutputs(stage as any, project).map(file => [file, fixture(project, file, {} as Service)]))]));
    const seed = fixture(project, paths.seed, {} as Service);
    const source = JSON.parse(request.messages.find((message: any) => message.role === 'user').content);
    const system = request.messages.find((message: any) => message.role === 'system').content;
    const stage = system.match(/当前阶段 (S\d+)/)?.[1] ?? 'S01';
    requests.push({ name, stage, at: new Date().toISOString(), resolutions: source.resolutions, lastRole: request.messages.at(-1).role, lastInstruction: request.messages.at(-1).role === 'user' ? request.messages.at(-1).content : undefined });
    fs.writeFileSync(path.join(base, sample + '-mock-requests.json'), JSON.stringify(requests, null, 2));
    const coverage = source.knowledge?.options.map((option: any) => ({ optionId: option.id, implementation: '城市设施出现局部异常', firstDemonstration: '检修员记录夜间故障', risk: '主角不能预知结果' }));
    let message;
    if (name === 'submit_planning_report') message = result(name, {
      positioning: '从日常检修切入的城市异常故事', diagnosis: [],
      assumptions: [
        { id: 'A_WORLD', text: '正常社会持续运转，异常仅有局部影响', critical: true, directionIds: [] },
        { id: 'A_HERO', text: '主角是检修员，依靠记录和试验辨认规则', critical: true, directionIds: ['D1'] },
        { id: 'A_OTHER', text: '另一方向由调查小组共同判断', critical: true, directionIds: ['D3'] }
      ],
      directions: ['夜间检修', '条款争议', '群体调查'].map((title, index) => ({ id: 'D' + (index + 1), title, logline: '检修员遇到不同寻常的故障', storyEngine: '记录、试验与救援选择', differenceFromOtherDirections: '查明原因的方法不同', openingDecision: '先救人还是先记录', firstVolumeChange: '建立可核对的事故记录', longRunRisk: '避免重复故障', intentChanges: [], tagCoverage: coverage })),
      recommendedDirectionId: 'D1', recommendationReasons: ['贴合作者提供的主角身份'], marketClaims: [], unresolvedQuestions: []
    });
    else if (name === 'submit_planning_review') message = result(name, { issues: [] });
    else if (name === 'submit_creation_contract') message = result(name, { directionId: source.selectedDirectionId, constraints: [{ id: 'C_SCOPE', optionIds: source.knowledge.options.map((option: any) => option.id), text: '异常局限在设施周边，检修员通过记录与试验判断，不具备全知能力。', scope: { entityIds: [], fromChapter: null, toChapter: null }, evidenceRef: source.selectedDirectionId }], tagCoverage: coverage, openQuestions: [], premiseDocument: seed });
    else if (request.messages.at(-1).role === 'tool') message = { role: 'assistant', content: '本阶段方案已完成。请审阅结果，确认后继续下一阶段。' };
    else {
      if (!stageContent[stage]) throw new Error('Unapproved fixture stage ' + stage);
      message = result('propose_changes', { changes: Object.entries(stageContent[stage]).map(([file, content]) => {
        const source = fs.readFileSync(path.join(project.root, file));
        return { path: file, content, baseHash: crypto.createHash('sha256').update(source).digest('hex') };
      }) });
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message, finish_reason: 'tool_calls' in message ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 20 } }));
  } catch (error) { res.writeHead(500); res.end(String(error)); }
});
server.listen(19453, '127.0.0.1', () => console.log('Isolated workflow fixture on 127.0.0.1:19453'));
