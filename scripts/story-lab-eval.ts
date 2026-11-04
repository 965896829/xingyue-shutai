import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app, safeStorage } from 'electron';
import { DatabaseSync } from 'node:sqlite';
import { Service } from '../src/core/service';
import { StoryLabService } from '../src/core/story-lab/service';
import { FileStore, atomicWrite } from '../src/core/storage';
import { invokeModel, requestBody, RequestError } from '../src/core/provider';
import { callModel, attempts } from '../src/core/runtime/model-gateway';
import { labGenerateSchema, labRequirementsSchema, labFailure } from '../src/shared/story-lab';
import type { SecretProfile } from '../src/shared/types';

// This is an opt-in, bounded comparison. Never run it as a build or test side effect.
if (!process.argv.includes('--authorized-story-lab-comparison'))
  throw new Error('真实模型对照需要显式启用 --authorized-story-lab-comparison');
const output = path.resolve('.test-output/story-lab-live', new Date().toISOString().replaceAll(':', '-'));
fs.mkdirSync(output, { recursive: true });
const save = (name: string, value: unknown) =>
  atomicWrite(path.join(output, name), typeof value === 'string' ? value : JSON.stringify(value, null, 2));
const sourceSettings = path.join(app.getPath('appData'), 'wenxu-desktop');
const auth = fs.mkdtempSync(path.join(os.tmpdir(), 'xingyue-story-lab-auth-'));
if (fs.existsSync(path.join(sourceSettings, 'Local State')))
  fs.copyFileSync(path.join(sourceSettings, 'Local State'), path.join(auth, 'Local State'));
app.setPath('userData', auth);
const report: any = {
  startedAt: new Date().toISOString(),
  output,
  maxCalls: 7,
  calls: [],
  cases: {},
  quality: '待实际阅读；单次样本不证明稳定优于任何流程'
};
let label = '',
  count = 0;
const capture: typeof invokeModel = async (...args) => {
  if (count >= report.maxCalls) throw new RequestError('对照请求次数上限已到；未发送', false);
  const ordinal = ++count,
    prefix = `${ordinal}-${label}`;
  const row: any = {
    ordinal,
    case: label,
    status: 'dispatching',
    startedAt: new Date().toISOString(),
    effectiveReasoning: args[0].reasoningEffort ?? null,
    effectiveTransport: args[0].protocol === 'responses' ? args[0].responsesTransport ?? 'http' : 'http',
    timeoutSeconds: args[0].timeoutSeconds,
    outputLimit: args[0].outputLimit
  };
  report.calls.push(row);
  save('report.json', report);
  save(`${prefix}-input.json`, { system: args[1], messages: args[2], tools: args[3] });
  save(`${prefix}-wire.json`, requestBody(args[0], args[1], args[2], args[3], args[6]).body);
  let partial = '';
  const delta = args[5];
  args[5] = (text) => {
    partial += text;
    delta?.(text);
  };
  try {
    const result = await invokeModel(...args);
    save(`${prefix}-result.json`, result);
    save(`${prefix}.md`, result.text);
    Object.assign(row, { status: result.stop, usage: result.usage, endedAt: new Date().toISOString() });
    return result;
  } catch (error) {
    save(`${prefix}-partial.md`, partial);
    Object.assign(row, {
      status: 'failed_or_unknown',
      error: error instanceof RequestError ? error.message : (error as Error).name,
      failure: labFailure(error instanceof RequestError ? error.diagnostic : undefined)
    });
    throw error;
  } finally {
    row.endedAt = new Date().toISOString();
    save('report.json', report);
  }
};

async function main() {
  await app.whenReady();
  const settings = JSON.parse(fs.readFileSync(path.join(sourceSettings, 'settings.json'), 'utf8'));
  let defaultId = '';
  if (settings.recent?.[0]?.root) {
    const file = path.join(settings.recent[0].root, '.novelclient/state.sqlite');
    if (fs.existsSync(file)) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        defaultId = JSON.parse(String(db.prepare("SELECT value FROM kv WHERE key='project'").get()!.value))
          .config.defaultProfileId;
      } finally {
        db.close();
      }
    }
  }
  const configured =
    settings.profiles.find((p: any) => p.id === defaultId && p.enabled && p.encryptedKey) ??
    settings.profiles.find((p: any) => p.enabled && p.encryptedKey && p.protocol !== 'images');
  if (!configured) throw new Error('没有可用的已配置模型');
  const { encryptedKey, ...publicProfile } = configured;
  const profile: SecretProfile = {
    ...publicProfile,
    apiKey: safeStorage.decryptString(Buffer.from(encryptedKey, 'base64')),
    outputLimit: Math.min(16384, configured.outputLimit),
    stream: true,
    ...(configured.protocol === 'responses' ? { responsesTransport: 'http' as const } : {}),
    networkRecovery: { maxRetries: 0, retryUnknown: false }
  };
  const plain = { ...profile, tools: false };
  report.configuration = {
    model: profile.model,
    profileId: profile.id,
    protocol: profile.protocol,
    transport: profile.responsesTransport ?? 'http',
    outputLimit: profile.outputLimit,
    contextLimit: profile.contextLimit,
    reasoningEffort: profile.reasoningEffort,
    inputPrice: profile.inputPrice,
    outputPrice: profile.outputPrice,
    currency: profile.currency,
    pricesAreConfiguredEstimates: true
  };
  const idea =
    '东方玄幻＋脑洞＋规则怪谈，全书300万字，每章2300—2700字。给我一套有强烈辨识度、相互关联的完整作品构想。人物有自己的欲望和立场。文字使用自然完整的中文，不写成机械短句和规则说明书。';
  const journalRoot = path.join(output, 'direct-journal');
  fs.mkdirSync(journalRoot);
  const journal = new FileStore(journalRoot);
  const lab = new StoryLabService(
    path.join(output, 'story-lab'),
    path.resolve('resources/skill'),
    () => [profile],
    () => {},
    capture
  );
  const formal = new Service(path.resolve('resources/skill'), () => {}, capture);
  formal.profiles = [profile];
  const request = (sessionId: string, extra: Record<string, unknown> = {}) =>
    labGenerateSchema.parse({
      sessionId,
      requestId: crypto.randomUUID(),
      action: 'blueprint',
      baseVersionId: null,
      ...extra
    });
  async function caseRun(name: string, fn: () => Promise<void>) {
    label = name;
    const before = count;
    try {
      await fn();
      report.cases[name] = { ...report.cases[name], status: 'finished', calls: count - before };
    } catch (error) {
      report.cases[name] = {
        status: 'failed_or_unknown',
        calls: count - before,
        error: error instanceof RequestError ? error.message : (error as Error).message
      };
    }
    save('report.json', report);
    console.log(JSON.stringify({ case: name, ...report.cases[name] }));
  }
  let labVersion = '';
  const session = lab.create({
    id: crypto.randomUUID(),
    requirements: labRequirementsSchema.parse({ idea }),
    profileId: profile.id,
    outputLimit: profile.outputLimit
  }).session;
  try {
    await caseRun('direct-blueprint', async () => {
      const result = await callModel(
        journal,
        {
          id: crypto.randomUUID(),
          reasoningEfforts: { [profile.id]: profile.reasoningEffort ?? null },
          usage: { input: 0, output: 0, cost: 0, currency: profile.currency }
        },
        'direct-comparison',
        capture,
        plain,
        '',
        [{ role: 'user', content: idea }],
        [],
        new AbortController().signal
      );
      save('direct-blueprint.md', result.text);
    });
    await caseRun('lab-blueprint', async () => {
      const input = request(session.id);
      lab.start(input);
      await lab.settled(session.id);
      const result = lab.store.get('requests', input.requestId)!;
      if (result.status !== 'complete') throw new Error(`实验室请求状态：${result.status}；${result.error}`);
      labVersion = result.versionId!;
      lab.select({ sessionId: session.id, versionId: labVersion, expectedRevision: 0, reviewedStale: false });
      save('lab-blueprint.md', lab.store.version(session.id, labVersion).content);
      const actual = attempts(lab.store.journal, result.id)[0];
      const body = lab.store.journal.object(actual.requestRef!).toString();
      report.isolation = {
        attempts: result.attempts,
        project: lab.store.journal.db.project() ?? null,
        oldPromptMarkersPresent: /S01|S11|章后记忆|propose_changes|memory_extract/.test(body),
        sessionId: session.id
      };
    });
    await caseRun('formal-S01', async () => {
      await formal.invoke('project.create', {
        parent: output,
        title: '自由实验室正式流程对照',
        premise: idea,
        config: {
          defaultProfileId: profile.id,
          targetWords: 3000000,
          chapterWords: 2500,
          minWords: 2300,
          maxWords: 2700,
          maxRounds: 3,
          preview: { enabled: false }
        }
      });
      const runId = await formal.invoke('run.start', { request: idea, profileId: profile.id });
      while (formal.store!.db.run(runId).status === 'running')
        await new Promise((resolve) => setTimeout(resolve, 500));
      const run = formal.store!.db.run(runId);
      save('formal-S01-run.json', run);
      save(
        'formal-S01.md',
        run.responseText + '\n\n' + run.changes.map((c) => `# ${c.path}\n\n${c.content}`).join('\n\n')
      );
      report.cases['formal-S01'] = {
        runStatus: run.status,
        stage: 'S01',
        scope: '正式流程首阶段；最多3次请求，不执行S02—S11，不作为完整蓝图的同等样本',
        changes: run.changes.length
      };
    });
    if (labVersion) {
      const selected = lab.store.version(session.id, labVersion);
      const proseInput = request(session.id, {
        action: 'prose',
        baseVersionId: labVersion,
        instruction: '用这套设定写第一章，2300—2700字。只交小说正文。'
      });
      const context = lab.preview(proseInput);
      // Both prose arms receive exactly the same selected early-story material and scene instruction.
      save('shared-prose-material.md', context.user);
      await caseRun('direct-prose', async () => {
        const result = await callModel(
          journal,
          {
            id: crypto.randomUUID(),
            reasoningEfforts: { [profile.id]: profile.reasoningEffort ?? null },
            usage: { input: 0, output: 0, cost: 0, currency: profile.currency }
          },
          'direct-prose-comparison',
          capture,
          plain,
          '',
          [{ role: 'user', content: context.user }],
          [],
          new AbortController().signal
        );
        save('direct-prose.md', result.text);
      });
      await caseRun('lab-prose', async () => {
        lab.start(proseInput);
        await lab.settled(session.id);
        const result = lab.store.get('requests', proseInput.requestId)!;
        save('lab-prose.md', result.response);
        report.cases['lab-prose'] = { resultStatus: result.status, sourceVersion: selected.id };
      });
    }
  } finally {
    await lab.close();
    await formal.drain();
    journal.close();
    report.endedAt = new Date().toISOString();
    save('report.json', report);
    console.log(`Evidence: ${output}`);
  }
}
main()
  .then(() => app.exit(0))
  .catch((error) => {
    report.failure = (error as Error).message;
    save('report.json', report);
    console.error((error as Error).message);
    app.exit(1);
  });
