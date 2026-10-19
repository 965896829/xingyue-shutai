import { parentPort, workerData } from 'node:worker_threads';
import { importDocument } from '../src/core/document-import';

if (!parentPort) throw new Error('文档解析入口只能在线程中运行');
try {
  if (!workerData || typeof workerData.file !== 'string') throw new Error('文档路径无效');
  parentPort.postMessage({ ok: true, result: importDocument(workerData.file) });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : '文档解析失败' });
} finally { parentPort.close(); }
