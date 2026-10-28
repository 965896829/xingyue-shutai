/** Real-provider, isolated client-engine run. No model responses are mocked. */
import { app, safeStorage } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Service } from '../src/core/service';
import { invokeModel, requestBody } from '../src/core/provider';
import { profileSchema, type Run } from '../src/shared/types';

const configArg = process.argv.find(v => v.startsWith('--harness-config='));
if (!configArg) throw new Error('Pass --harness-config=<absolute JSON path>');
const config = JSON.parse(fs.readFileSync(configArg.slice('--harness-config='.length), 'utf8'));
const records: string = path.resolve(config.recordsRoot);
if (config.cleanRun && (config.resumeRoot || config.resumeRunId || fs.existsSync(path.join(records, 'session.json'))))
  throw new Error('Clean benchmark must start in a new record directory and a new project');
fs.mkdirSync(records, { recursive: true });
const isolatedUserData = path.join(records, 'electron-profile');
fs.mkdirSync(isolatedUserData, { recursive: true });
const localState = path.join(path.dirname(config.settingsFile), 'Local State');
if (fs.existsSync(localState) && !fs.existsSync(path.join(isolatedUserData, 'Local State')))
  fs.copyFileSync(localState, path.join(isolatedUserData, 'Local State'));
app.setPath('userData', isolatedUserData);
app.setPath('sessionData', isolatedUserData);
app.setName('星月书台流程复测');
const write = (file: string, value: unknown) => {
  const target = path.join(records, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  // Windows readers/antivirus may briefly hold the replaced file without delete
  // sharing. A live status mirror must never abort an in-flight model request.
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(temporary, target); return; }
    catch (error: any) {
      const transient = ['EPERM', 'EACCES', 'EBUSY'].includes(error.code);
      if (transient && attempt < 20) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
        continue;
      }
      if (transient && file === 'status.json') {
        fs.appendFileSync(path.join(records, 'recorder-warnings.jsonl'), JSON.stringify({
          at: new Date().toISOString(), file, code: error.code,
          message: 'Status mirror skipped after bounded replacement retries; generation continues.'
        }) + '\n');
        return;
      }
      throw error;
    }
  }
};
const log = (file: string, value: unknown) => fs.appendFileSync(path.join(records, file), JSON.stringify(value) + '\n');
const stamp = () => new Date().toISOString();
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
let service: Service;
let requestNo = 0;
let activeRequest: { number: number; startedAt: string; label: string } | undefined;
function assertFrozen() {
  if (!config.cleanRun) return;
  if (!config.frozenManifest) throw new Error('Clean benchmark requires a frozen source/resource manifest');
  const manifest = JSON.parse(fs.readFileSync(config.frozenManifest, 'utf8'));
  for (const file of manifest.files) {
    const target = path.resolve(manifest.root, file.path);
    if (crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') !== file.sha256)
      throw new Error(`Frozen source changed during clean benchmark: ${file.path}`);
  }
}
const publicProfile = (p: any) => ({
  id: p.id, name: p.name, model: p.model, protocol: p.protocol, responsesTransport: p.responsesTransport,
  reasoningEffort: p.reasoningEffort, contextLimit: p.contextLimit, inputLimit: p.inputLimit,
  outputLimit: p.outputLimit, timeoutSeconds: p.timeoutSeconds, stream: p.stream,
  networkRecovery: p.networkRecovery, temperature: p.temperature
});
function saveText(relative: string, content: string, prefix: string) {
  const root = path.resolve(records, prefix), target = path.resolve(root, relative);
  if (!target.startsWith(root + path.sep)) throw new Error('Invalid artifact path');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
}
function snapshotCandidate(run: Run) {
  write('current-run.json', run);
  const prefix = `candidates/${run.stage}-${run.id}`;
  for (const destination of [prefix, `${prefix}/versions/${Date.now()}`]) {
    write(destination + '/run.json', run);
    for (const change of run.changes) saveText(change.path, change.content, destination + '/files');
    for (const draft of run.documentDrafts ?? []) saveText(draft.path, draft.content, destination + '/drafts');
  }
}
async function main() {
  assertFrozen();
  await app.whenReady();
  const settings = JSON.parse(fs.readFileSync(config.settingsFile, 'utf8'));
  const chosen = settings.profiles.find((p: any) => p.id === config.profileId);
  if (!chosen) throw new Error('Configured profile not found');
  const apiKey = safeStorage.decryptString(Buffer.from(chosen.encryptedKey, 'base64'));
  if (!apiKey) throw new Error('Encrypted model key could not be loaded');
  const profile = { ...profileSchema.parse({ ...chosen,
    ...(config.responsesTransport ? { responsesTransport: config.responsesTransport } : {})
  }), apiKey };
  write('preflight.json', { at: stamp(), model: publicProfile(profile), keyDecrypted: true, realProvider: true });
  if (config.preflightOnly) return;
  if (fs.existsSync(path.join(records, 'requests.jsonl')))
    requestNo = fs.readFileSync(path.join(records, 'requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length;
  service = new Service(path.resolve(config.skillRoot), event => log('events.jsonl', { recordedAt: stamp(), ...event }),
    async (p, system, messages, tools, signal, delta, options) => {
      assertFrozen();
      const number = ++requestNo, startedAt = stamp(), started = performance.now();
      const current = service.store?.db.runs().find(r => r.status === 'running');
      const pending = service.store?.db.sql.prepare("SELECT data FROM model_attempts WHERE status='dispatching' ORDER BY rowid DESC LIMIT 1").get();
      const purpose = pending ? JSON.parse(String(pending.data)).purpose : undefined;
      const label = `${current?.stage ?? 'unknown'}:${purpose ?? current?.pipeline?.phase ?? current?.mode ?? 'stage'}`;
      let firstResponseAt: string | undefined, previousActivity = '';
      activeRequest = { number, startedAt, label };
      write(`requests/${String(number).padStart(3, '0')}-input.json`, {
        number, startedAt, label, profile: publicProfile(p), system, messages, tools,
        options: { webSearch: options?.webSearch, promptCacheKey: options?.promptCacheKey },
        wireBody: requestBody(p, system, messages, tools, options).body
      });
      log('lifecycle.jsonl', { at: startedAt, type: 'request-start', number, label });
      try {
        const result = await invokeModel(p, system, messages, tools, signal, text => {
          log('stream.jsonl', { at: stamp(), number, text });
          delta?.(text);
        }, { ...options, onActivity: activity => {
          if (activity === 'responding' && !firstResponseAt) firstResponseAt = stamp();
          if (activity !== previousActivity) log('activity.jsonl', { at: stamp(), number, activity });
          previousActivity = activity;
          options?.onActivity?.(activity);
        } });
        const receipt = { number, label, startedAt, endedAt: stamp(), elapsedMs: performance.now() - started,
          status: 'complete', firstResponseAt, usage: result.usage, stop: result.stop, calls: result.calls.map(call => ({ id: call.id, name: call.name })) };
        write(`requests/${String(number).padStart(3, '0')}-output.json`, result);
        log('requests.jsonl', receipt);
        log('lifecycle.jsonl', { at: stamp(), type: 'request-end', ...receipt });
        return result;
      } catch (error: any) {
        const receipt = { number, label, startedAt, endedAt: stamp(), elapsedMs: performance.now() - started,
          status: 'failed', error: error.message, diagnostic: error.diagnostic, uncertain: error.uncertain };
        if (error.partial) write(`requests/${String(number).padStart(3, '0')}-partial-output.json`, error.partial);
        write(`requests/${String(number).padStart(3, '0')}-error.json`, receipt);
        log('requests.jsonl', receipt);
        log('lifecycle.jsonl', { at: stamp(), type: 'request-error', ...receipt });
        throw error;
      } finally { activeRequest = undefined; }
    });
  service.profiles = [profile];
  const premiseText = fs.readFileSync(config.seedFile, 'utf8');
  const titleAt = premiseText.indexOf('## 《大逃杀：杀我之前，请出示死亡权》');
  const premise = titleAt >= 0 ? premiseText.slice(titleAt) : premiseText;
  saveText('原始设定.md', premise, 'input');
  const begin = { at: stamp(), config: { ...config, settingsFile: path.basename(config.settingsFile) }, model: publicProfile(profile) };
  log('lifecycle.jsonl', { type: 'session-start', ...begin });
  if (config.resumeRoot) await service.open(config.resumeRoot);
  else await service.invoke('project.create', { parent: config.projectParent, title: config.title, premise,
    config: { ...config.projectConfig, defaultProfileId: profile.id } });
  const session = { ...begin, root: service.store!.db.project().root, projectId: service.store!.db.project().id };
  write(`sessions/${Date.now()}.json`, session);
  if (!fs.existsSync(path.join(records, 'session.json'))) write('session.json', session);
  let currentId = config.resumeRunId ?? '';
  let stageStartedAt = config.resumeStageStartedAt ?? stamp();
  while (!service.store!.db.project().chapters[1] || service.store!.db.project().chapters[1] !== 'complete') {
    const project = service.store!.db.project();
    if (!currentId) {
      assertFrozen();
      stageStartedAt = stamp();
      if (config.cleanRun && project.stage === 'S01')
        write('benchmark-start.json', { at: stageStartedAt, protocol: 'frozen-code-fresh-project', frozenManifest: config.frozenManifest });
      currentId = await service.invoke('run.start', {
        profileId: profile.id,
        request: `按原 Skill 执行 ${project.stage}。沿用原设定、已确认上游文档与原模板字段，逐项完成本阶段产物。` +
          '完整保留作者的角色、死亡权规则、八卷走向及前三章承诺；未揭晓真相不得提前公开给读者。目标210万字，每章2500字，本批第1—30章。'
      });
      log('stages.jsonl', { type: 'stage-start', at: stageStartedAt, stage: project.stage, chapter: project.chapter, runId: currentId });
    }
    let idleSaved = false;
    while (true) {
      await sleep(500);
      const run = service.store!.db.run(currentId);
      write('status.json', { at: stamp(), project: { root: project.root, stage: project.stage, chapter: project.chapter },
        run: { id: run.id, status: run.status, rounds: run.rounds, error: run.error, issues: run.issues,
          changes: run.changes.map(c => ({ path: c.path, chars: c.content.length })),
          drafts: run.documentDrafts?.map(d => ({ path: d.path, chars: d.content.length, chunks: d.chunks })),
          proposalHash: run.proposalHash, pipeline: run.pipeline }, activeRequest, requests: requestNo,
        busy: !!service.runner!.controller, telemetryBusy: service.runner!.telemetry.busy });
      if (service.runner!.controller || service.runner!.telemetry.busy) { idleSaved = false; continue; }
      if (!idleSaved) {
        snapshotCandidate(run);
        log('stages.jsonl', { type: 'stage-idle', at: stamp(), stage: run.stage, runId: run.id, status: run.status,
          elapsedMs: Date.now() - Date.parse(stageStartedAt), error: run.error, issues: run.issues });
        idleSaved = true;
      }
      const commandPath = path.join(records, 'control.json');
      let command: any;
      if (config.cleanRun && config.autoAccept && run.status === 'awaiting_review' && !run.issues.some(issue => issue.severity === 'error')) {
        assertFrozen();
        command = { action: 'accept', runId: run.id, proposalHash: run.proposalHash,
          reason: '作者已授权整套隔离复测。冻结策略：保留完整静态检查、独立正文审核、事实证据核验及后续计划核对；非阻断警告原样记录，最终另做内容复核。',
          source: 'predeclared-clean-benchmark-policy' };
      } else {
        if (config.cleanRun && !fs.existsSync(commandPath)) {
          write('benchmark-stopped.json', { at: stamp(), stage: run.stage, runId: run.id, status: run.status,
            reason: '冻结复测出现未自动完成的状态；该样本完整保留，代码修复不得混入本次计时。', issues: run.issues, error: run.error });
          return;
        }
        if (!fs.existsSync(commandPath)) continue;
        command = JSON.parse(fs.readFileSync(commandPath, 'utf8'));
        if (config.cleanRun) throw new Error('Clean benchmark does not accept manual edits, budget changes or resume controls');
      }
      if (command.runId !== currentId) continue;
      if (fs.existsSync(commandPath)) fs.renameSync(commandPath, path.join(records, `control-${Date.now()}.json`));
      log('controls.jsonl', { at: stamp(), ...command });
      try {
        if (command.action === 'accept') {
          await service.invoke('run.accept', { id: run.id, proposalHash: command.proposalHash, startNext: false,
            ...(command.reason ? { warningReason: command.reason } : {}) });
          const manifest: any[] = [];
          for (const info of service.store!.documentListing()) {
            const doc = service.store!.readAccepted(info.path);
            saveText(info.path, doc.content, `stage-snapshots/${run.stage}`);
            manifest.push({ path: info.path, chars: doc.content.length, hash: crypto.createHash('sha256').update(doc.content).digest('hex') });
          }
          write(`stage-snapshots/${run.stage}/manifest.json`, manifest);
          log('stages.jsonl', { type: 'stage-accepted', at: stamp(), stage: run.stage, chapter: run.chapter, runId: run.id,
            elapsedMs: Date.now() - Date.parse(stageStartedAt), usage: run.usage, proposalHash: run.proposalHash });
          currentId = '';
          break;
        }
        if (command.action === 'recover') {
          const recoveredId = await service.invoke('run.recover', { id: run.id, profileId: profile.id, instruction: command.instruction,
            retryUnknown: command.retryUnknown === true });
          if (recoveredId !== currentId) {
            log('stages.jsonl', { type: 'stage-handoff', at: stamp(), stage: run.stage,
              runId: currentId, toRunId: recoveredId, stageStartedAt });
            currentId = recoveredId;
          }
          idleSaved = false;
        }
        if (command.action === 'update') {
          if (command.proposalHash !== run.proposalHash) throw new Error('Author edit targets a stale candidate');
          const before = run.changes.find(change => change.path === command.path);
          if (!before) throw new Error('Author edit target is not an existing candidate');
          const beforeHash = crypto.createHash('sha256').update(before.content).digest('hex');
          if (command.contentHash !== beforeHash) throw new Error('Author edit content hash does not match');
          const updated = await service.invoke('run.update', { id: run.id, path: command.path, content: command.content });
          log('stages.jsonl', { type: 'candidate-author-edit', at: stamp(), stage: run.stage, runId: run.id,
            path: command.path, beforeHash, afterHash: crypto.createHash('sha256').update(command.content).digest('hex'),
            reason: command.reason, proposalHash: updated.proposalHash, issues: updated.issues });
          idleSaved = false;
        }
        if (command.action === 'budget') {
          const beforeProject = service.store!.db.project();
          if (!Number.isInteger(command.maxRounds) || command.maxRounds <= beforeProject.config.maxRounds || command.maxRounds > 100)
            throw new Error('Expected an explicit bounded increase to this isolated project round limit');
          if (!command.reason) throw new Error('Budget change requires a recorded reason');
          await service.invoke('project.configure', { config: { ...beforeProject.config, maxRounds: command.maxRounds } });
          const afterProject = service.store!.db.project();
          const afterRun = service.store!.db.run(run.id);
          if (afterRun.rounds !== run.rounds || afterRun.toolCount !== run.toolCount)
            throw new Error('Budget configuration unexpectedly changed consumed counters');
          log('stages.jsonl', { type: 'budget-adjustment', at: stamp(), stage: run.stage, runId: run.id,
            beforeMaxRounds: beforeProject.config.maxRounds, afterMaxRounds: afterProject.config.maxRounds,
            consumedRounds: afterRun.rounds, consumedTools: afterRun.toolCount, reason: command.reason,
            scope: 'isolated-test-project-only', stageBudgetUnchanged: JSON.stringify(beforeProject.config.stageBudget) === JSON.stringify(afterProject.config.stageBudget) });
          idleSaved = false;
        }
        if (command.action === 'answer') {
          await service.invoke('run.answer', command.args);
          idleSaved = false;
        }
        if (command.action === 'stop') return;
      } catch (error: any) {
        write('control-error.json', { at: stamp(), command, error: error.message });
        log('lifecycle.jsonl', { type: 'control-error', at: stamp(), error: error.message });
        if (config.cleanRun) {
          write('benchmark-stopped.json', { at: stamp(), stage: run.stage, runId: run.id,
            status: run.status, reason: '自动采纳失败，冻结样本停止，不重试或混入手工修订。', error: error.message });
          return;
        }
      }
    }
  }
  assertFrozen();
  write('complete.json', { at: stamp(), project: service.store!.db.project(), requestCount: requestNo });
}
main().then(async () => {
  if (service) await service.drain();
  log('lifecycle.jsonl', { type: 'session-end', at: stamp() });
  app.quit();
}).catch(async error => {
  write('fatal.json', { at: stamp(), error: error.message, stack: error.stack });
  console.error(error.message);
  if (service) await service.drain().catch(() => {});
  app.exit(1);
});
