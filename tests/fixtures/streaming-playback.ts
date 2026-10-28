import type { Service } from '../../src/core/service';
import { detailPath, prosePath, paths, hash, id } from '../../src/core/domain';
import { saveNarrativeEvents } from '../../src/core/narrative-curves';
import { NarrativeDecoder } from '../../src/shared/narrative-events';

import { playbackPlan, playbackProse, playbackResponse } from './streaming-content';
export { playbackPlan, playbackProse } from './streaming-content';

export async function createPlaybackFixture(service: Service, parent: string) {
  await service.invoke('project.create', { parent, title: '流式输出与节奏同步验收', premise: '仅用于本地界面性能验收的合成故事。',
    config: { defaultProfileId: 'fixture', expressionRules: { enabled: false }, preview: { enabled: false, maxCalls: 8 }, chapterWords: 2500 } });
  const store = service.store!, project = store.db.project();
  project.stage = 'S10'; project.revision++;
  store.commit([{ path: detailPath(1), baseHash: store.db.document(detailPath(1))?.hash ?? null, content: playbackPlan },
    { path: paths.outline, baseHash: store.db.document(paths.outline)?.hash ?? null, content: '# 总纲\n\n| 章节 | 类型 | 强度 |\n| --- | --- | --- |\n' + [4, 3, 2, 4, 5, 2, 3, 4, 2, 5].map((strength, i) => `| ${i + 1} | 推进 | ${strength} |`).join('\n') }], project);
  const run = service.makeRun('stage', '生成第001章正文', 'fixture');
  store.db.saveRun(run);
  let timer: ReturnType<typeof setTimeout> | undefined, offset = 0, eventCount = 0, startedAt = 0, endedAt = 0;
  const notify = () => service.emit({ type: 'snapshot', resource: 'runs', runId: run.id });
  const stop = () => {
    if (timer) clearTimeout(timer); timer = undefined;
    run.status = 'paused'; store.db.saveRun(run); endedAt = performance.now(); notify();
  };
  const start = () => {
    if (timer) clearTimeout(timer);
    offset = 0; eventCount = 0; startedAt = performance.now(); endedAt = 0;
    run.status = 'running'; run.pipeline!.phase = 'prose'; run.pipeline!.proseHash = undefined;
    run.pipeline!.epoch = id(); run.pipeline!.version++; run.pipeline!.narrative = { version: 1, epoch: run.pipeline!.epoch, events: [] };
    run.changes = []; store.db.saveRun(run); notify();
    let persistedAt = 0;
    const decoder = new NarrativeDecoder(text => {
      run.pipeline!.version++;
      run.changes = [{ path: prosePath(1), baseHash: store.db.document(prosePath(1))?.hash ?? null, content: decoder.text }];
      service.emit({ type: 'prose-delta', resource: 'runs', runId: run.id, epoch: run.pipeline!.epoch,
        draftVersion: run.pipeline!.version, text, textOffset: decoder.text.length - text.length });
    }, event => {
      run.pipeline!.narrative!.events.push(event);
      service.emit({ type: 'narrative-event', resource: 'runs', runId: run.id, epoch: run.pipeline!.epoch,
        draftVersion: run.pipeline!.version, data: run.pipeline!.narrative });
      store.db.saveRun(run);
    });
    const tick = () => {
      const size = [8, 14, 100, 4, 34, 140][eventCount % 6];
      const text = playbackResponse.slice(offset, offset + size);
      offset += text.length; eventCount++;
      decoder.push(text);
      if (performance.now() - persistedAt > 800) { store.db.saveRun(run); persistedAt = performance.now(); }
      if (offset < playbackResponse.length) timer = setTimeout(tick, [20, 30, 300, 15, 100, 320][eventCount % 6]);
      else { timer = undefined;
        decoder.finish(); saveNarrativeEvents(store, run, decoder.text);
        run.status = 'awaiting_review'; run.pipeline!.phase = 'ready'; run.pipeline!.proseHash = hash(playbackProse);
        store.db.saveRun(run); endedAt = performance.now(); notify(); }
    };
    timer = setTimeout(tick, 180);
    return { id: run.id, expectedLength: playbackProse.length };
  };
  return { start, stop, metrics: () => ({ id: run.id, eventCount, nodes: run.pipeline!.narrative?.events.length ?? 0,
    received: run.changes[0]?.content.length ?? 0, rawReceived: offset, expectedLength: playbackProse.length, running: !!timer,
    elapsedMs: (endedAt || performance.now()) - startedAt, expectedText: playbackProse }) };
}
