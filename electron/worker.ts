import { z } from 'zod';
import { Service } from '../src/core/service';
import { ProjectRecycleBin } from '../src/core/recycle-bin';
import { buildVersion, protocolVersion } from '../src/shared/build';
import { requestSchema } from '../src/shared/ipc';
import { ApplicationError, errorPayload } from '../src/shared/errors';
import { commandContracts } from '../src/shared/contracts';
import { profileSchema, roleRuleSchema } from '../src/shared/contract-schemas';
import { searchSettingsSchema } from '../src/shared/assistant';
import { embeddingSettingsSchema } from '../src/shared/studio';
import fs from 'node:fs';
import path from 'node:path';
import { FileStore } from '../src/core/storage';
import { recoverAttempts } from '../src/core/runtime/model-gateway';
import { DocumentImporter } from '../src/core/runtime/document-importer';

const port = process.parentPort!;
let generation = 0;
let ready = false;
let draining = false;
const importer = new DocumentImporter(path.join(__dirname, 'document-worker.cjs'));
const service = new Service(process.argv[2], (event) => port.postMessage({ event: { ...event, protocolVersion, workerGeneration: generation } }), undefined, (file, signal) => importer.read(file, signal));
const requestRoot = path.join(process.argv[3], 'request-journal');
fs.mkdirSync(requestRoot, { recursive: true });
service.requestJournal = new FileStore(requestRoot);
recoverAttempts(service.requestJournal);
try { service.recycleBin = new ProjectRecycleBin(process.argv[3]); }
catch { service.emit({ type: 'error', text: '回收站配置不可用，原记录保留，自动清理已暂停' }); }

const configuration = z.object({
  type: z.enum(['initialize', 'configuration']), protocolVersion: z.literal(protocolVersion), buildVersion: z.literal(buildVersion), workerGeneration: z.number().int().positive(),
  profiles: z.array(z.intersection(profileSchema, z.object({ apiKey: z.string() }))),
  recent: z.array(z.object({ title: z.string(), root: z.string() })), assistant: z.object({ roles: z.array(roleRuleSchema), search: searchSettingsSchema, searchKey: z.string(), embedding: embeddingSettingsSchema.optional(), embeddingKey: z.string().optional() })
});

port.on('message', async ({ data }: { data: unknown }) => {
  const message = z.object({ type: z.string().optional(), requestId: z.string().optional() }).passthrough().safeParse(data);
  if (!message.success) return;
  const value = message.data;
  try {
    if (value.type === 'initialize' || value.type === 'configuration') {
      const init = configuration.parse(data);
      if (generation && init.workerGeneration !== generation) throw new ApplicationError('PROTOCOL_MISMATCH', '执行内核代次不一致');
      generation = init.workerGeneration;
      service.profiles = init.profiles;
      service.recent = init.recent;
      service.assistant = init.assistant;
      if (value.type === 'initialize') {
        ready = true;
        port.postMessage({ type: 'ready', protocolVersion, buildVersion, workerGeneration: generation, projectSessionId: service.projectSessionId });
      }
      return;
    }
    if (value.type === 'shutdown') {
      if (draining) return;
      draining = true;
      ready = false;
      await service.drain();
      port.postMessage({ type: 'shutdown-complete', workerGeneration: generation });
      setImmediate(() => process.exit(0));
      return;
    }
    const request = requestSchema.parse(data);
    if (!ready || draining) throw new ApplicationError('WORKER_UNAVAILABLE', '执行内核尚未就绪或正在关闭');
    if (request.workerGeneration !== generation) throw new ApplicationError('PROTOCOL_MISMATCH', '旧执行内核请求已失效');
    const result = await service.invoke(request.command, request.params, {
      operationId: request.operationId,
      projectSessionId: commandContracts[request.command].scope === 'project' ? request.projectSessionId : undefined
    });
    port.postMessage({ requestId: request.requestId, result, projectSessionId: service.projectSessionId, workerGeneration: generation });
  } catch (error) {
    const payload = errorPayload(error, [...service.profiles.map((p) => p.apiKey), service.assistant.searchKey, service.assistant.embeddingKey ?? '']);
    port.postMessage({ requestId: value.requestId, error: payload, workerGeneration: generation });
    if (!value.requestId) service.emit({ type: 'error', text: payload.message });
  }
});

setInterval(() => {
  if (!ready || draining) return;
  try { if (service.recycleBin?.sweep()) service.emit({ type: 'snapshot' }); }
  catch { service.emit({ type: 'error', text: '回收站清理未完成，原记录保留' }); }
}, 60_000).unref();
