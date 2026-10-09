import { Service } from '../src/core/service';
import type { SecretProfile } from '../src/shared/types';
import { ProjectRecycleBin } from '../src/core/recycle-bin';
const port = process.parentPort!;
const service = new Service(process.argv[2], (event) => port.postMessage({ event }));
try {
  service.recycleBin = new ProjectRecycleBin(process.argv[3]);
  service.recycleBin.sweep();
} catch (e) {
  port.postMessage({ event: { type: 'error', text: `回收站自动清理已暂停：${(e as Error).message}` } });
}
setInterval(() => {
  try {
    if (service.recycleBin?.sweep()) service.emit({ type: 'snapshot' });
  } catch (e) {
    service.emit({ type: 'error', text: `回收站清理未完成：${(e as Error).message}` });
  }
}, 60000).unref();
port.on('message', async ({ data }: any) => {
  if (data.type === 'assistant') {
    service.assistant = data.assistant;
    return;
  }
  if (data.type === 'profiles') {
    service.profiles = data.profiles as SecretProfile[];
    service.recent = data.recent ?? service.recent;
    return;
  }
  if (data.type === 'shutdown') {
    service.runner?.stop();
    service.chat?.stop();
    setTimeout(() => {
      try {
        service.store?.close();
      } finally {
        process.exit(0);
      }
    }, 300);
    return;
  }
  try {
    const result = await service.invoke(data.command, data.args);
    port.postMessage({ id: data.id, result });
  } catch (e) {
    port.postMessage({ id: data.id, error: (e as Error).message });
  }
});
let fingerprint = '';
setInterval(() => {
  if (!service.store) return;
  try {
    const next = service.store
      .scan()
      .map((d) => `${d.path}:${d.hash}`)
      .join('|');
    if (next !== fingerprint) {
      fingerprint = next;
      service.emit({ type: 'snapshot' });
    }
  } catch (e) {
    service.emit({ type: 'error', text: (e as Error).message });
  }
}, 2000).unref();
