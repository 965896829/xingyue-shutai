import fs from 'node:fs';
import path from 'node:path';
import { compileContext, contextPayload } from '../src/core/context-compiler';
import { assertRequestFits } from '../src/core/context-budget';
import { invokeModel, requestBody } from '../src/core/provider';
import { callModel } from '../src/core/runtime/model-gateway';
import { hash } from '../src/core/domain';
import { profileSchema, type SecretProfile } from '../src/shared/types';
import { contextBook, contextCase } from '../tests/fixtures/context-book';
import { fakeProfile } from '../tests/fixtures/refactor';

export async function evaluateContext(profile: SecretProfile, live = false, destination = '.test-output/context-eval') {
  const folder = path.resolve(destination);
  fs.mkdirSync(folder, { recursive: true });
  const { store, project } = contextBook(true);
  const selected = { ...profile, limitMode: 'manual' as const, outputLimit: Math.min(profile.outputLimit, 1200), stream: false };
  const manifest = compileContext(store, project, 'S10', contextCase.request, selected);
  const packet = JSON.stringify(contextPayload(manifest));
  const instruction = '这是虚构小说的资料核对测试。只按资料回答，不续写、不调用工具。作者规则必须遵守，但不是人物知道的事实。仅输出 JSON：{"alias":"小澈的正式姓名","canTeleport":true或false,"arm":"fractured或healed或unknown","knowsKeeper":true或false,"revealKeeperNow":true或false,"returnBeforeChapter":数字}。';
  const checks = (raw: string) => {
    const text = raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    const answer = JSON.parse(text);
    return { alias: answer.alias === '林澈', ability: answer.canTeleport === false, injury: answer.arm === 'fractured', knowledge: answer.knowsKeeper === false, revelation: answer.revealKeeperNow === false, promise: answer.returnBeforeChapter === 26 };
  };
  const report: any = { version: 1, at: new Date().toISOString(), live, model: selected.model, protocol: selected.protocol, endpointHash: hash(selected.baseUrl), compiler: manifest.assemblyVersion,
    suiteHash: hash(JSON.stringify({ contextCase, instruction, checks: ['alias','ability','injury','knowledge','revelation','promise'] })), cases: [], usage: { input: 0, output: 0, cost: null }, complete: false,
    limitation: '合成叙事状态核对；不能代表真实长篇文学质量。测试范围以实际回执为准，不自动提高模型容量或修改用户配置。' };
  const save = () => fs.writeFileSync(path.join(folder, 'report.json'), JSON.stringify(report, null, 2));
  try {
    for (const [i, target] of [8000, 16000, 32000].entries()) {
      const filler = Array.from({ length: Math.max(0, Math.ceil((target - packet.length) / 40)) }, (_, n) => `档案${n + 1}：港城天气记录，风向稳定，渡船照常停靠东岸。这条记录与人物状态、能力和玉钥身份无关。`).join('\n');
      const content = i === 0 ? packet + '\n其他档案：\n' + filler : i === 1 ? filler.slice(0, Math.floor(filler.length / 2)) + '\n正式资料包：\n' + packet + '\n' + filler.slice(Math.floor(filler.length / 2)) : '其他档案：\n' + filler + '\n正式资料包：\n' + packet;
      const messages = [{ role: 'user' as const, content }];
      const sizing = assertRequestFits(selected, requestBody(selected, instruction, messages, []).body);
      const row: any = { position: ['start','middle','end'][i], method: sizing.method, inputEstimate: sizing.tokens, inputBytes: sizing.bytes, actualInputTokens: null, status: live ? 'running' : 'compiled', checks: null };
      report.cases.push(row); save();
      console.log(JSON.stringify({ event: 'case', position: row.position, estimated: row.inputEstimate, live }));
      if (!live) { row.packetInvariant = manifest.hardConstraints!.some(f => f.id === 'ability-ban') && manifest.revelation!.withheld.some(f => f.id === 'key-secret') && !manifest.retrievedFacts!.some(f => f.id === 'key-secret'); continue; }
      const owner = { id: `context-eval-${i}-${crypto.randomUUID()}`, usage: { input: 0, output: 0, cost: 0, currency: selected.currency } };
      const response = await callModel(store, owner, 'context-evaluation', invokeModel, selected, instruction, messages, [], AbortSignal.timeout(Math.min(selected.timeoutSeconds, 180) * 1000));
      row.actualInputTokens = response.usage.input;
      row.usage = response.usage;
      row.response = response.text;
      row.checks = checks(response.text);
      row.status = response.stop === 'complete' && Object.values(row.checks).every(Boolean) ? 'passed' : 'failed';
      report.usage.input = report.usage.input === null || response.usage.input === null ? null : report.usage.input + response.usage.input;
      report.usage.output = report.usage.output === null || response.usage.output === null ? null : report.usage.output + response.usage.output;
      save();
      console.log(JSON.stringify({ event: 'result', position: row.position, status: row.status, actualInputTokens: row.actualInputTokens }));
      if (row.status !== 'passed') break;
    }
    report.complete = report.cases.length === 3 && report.cases.every((c: any) => live ? c.status === 'passed' : c.packetInvariant);
    report.verifiedInputTokens = live && report.complete && report.cases.every((c: any) => Number.isFinite(c.actualInputTokens)) ? Math.max(...report.cases.map((c: any) => c.actualInputTokens)) : null;
  } catch (error) {
    report.error = profile.apiKey ? (error as Error).message.replaceAll(profile.apiKey, '[密钥隐藏]') : (error as Error).message;
    report.complete = false;
    if (report.cases.at(-1)?.status === 'running') report.cases.at(-1).status = 'failed';
  } finally { save(); store.close(); }
  return report;
}

if (process.argv.includes('--run-context-eval')) {
  const index = process.argv.indexOf('--profile-file');
  const live = process.argv.includes('--live');
  if (live && index < 0) throw new Error('实际模型验收需要明确提供合成测试专用配置文件，未发起请求');
  const raw = index < 0 ? fakeProfile : JSON.parse(fs.readFileSync(path.resolve(process.argv[index + 1]), 'utf8'));
  const profile = { ...profileSchema.parse(raw), apiKey: process.env.WENXU_EVAL_API_KEY ?? '' };
  const output = process.argv.indexOf('--output');
  const report = await evaluateContext(profile, live, output < 0 ? undefined : process.argv[output + 1]);
  console.log(JSON.stringify({ complete: report.complete, live, cases: report.cases.length, verifiedInputTokens: report.verifiedInputTokens }));
  if (!report.complete) process.exitCode = 1;
}
