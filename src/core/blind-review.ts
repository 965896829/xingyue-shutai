import {
  reviewFeedbackSchema,
  reviewPacketSchema,
  type ReviewPacket,
  type PublicReviewPacket
} from '../shared/blind-review';
import { FileStore } from './storage';
import { Conversations } from './conversations';
import { hash, id, now } from './domain';
import { fingerprint } from './runtime/canonical';
import { readQuality, saveQuality } from './quality';
import { renderReviewPage } from '../shared/review-page';

export function publicReviewPacket(packet: ReviewPacket): PublicReviewPacket {
  return {
    packetId: packet.id,
    cases: packet.cases.map((c) => ({
      id: c.id,
      title: c.title,
      questions: c.questions,
      candidates: c.candidates.map((candidate) => ({ text: candidate.text, hash: candidate.hash }))
    }))
  };
}

export function registerReviewPacket(store: FileStore, cases: ReviewPacket['cases'], createdAt = now()) {
  return store.db.transaction(() => {
    const state = readQuality(store);
    const packet = reviewPacketSchema.parse({
      id: hash(JSON.stringify(publicReviewPacket({ id: '', createdAt, cases }).cases)),
      createdAt,
      cases
    });
    for (const c of cases) {
      const experiment = state.experiments.find((e) => e.id === c.experimentId);
      if (
        !experiment ||
        new Set(c.candidates.map((v) => v.candidateId)).size !== experiment.candidates.length ||
        c.candidates.some((v) => !experiment.candidates.some((e) => e.id === v.candidateId))
      )
        throw new Error('试读样稿与实验记录不一致');
      if (
        new Set(c.candidates.map((v) => v.hash)).size !== c.candidates.length ||
        c.candidates.some((v) => hash(v.text) !== v.hash)
      )
        throw new Error('试读样稿内容校验失败');
    }
    if (
      new Set(cases.map((c) => c.id)).size !== cases.length ||
      new Set(cases.map((c) => c.experimentId)).size !== cases.length
    )
      throw new Error('试读场景重复');
    const prior = state.reviewPackets.find((p) => p.id === packet.id);
    if (prior) return prior;
    state.reviewPackets.push(packet);
    saveQuality(store, state);
    return packet;
  });
}

export function exportReviewPage(store: FileStore, experimentIds: string[]) {
  if (!experimentIds.length || new Set(experimentIds).size !== experimentIds.length)
    throw new Error('请选择不同的试读场景');
  const state = readQuality(store),
    drafts = new Conversations(store);
  const cases = experimentIds.map((experimentId, index) => {
    const experiment = state.experiments.find((e) => e.id === experimentId);
    if (!experiment) throw new Error('试读场景不存在');
    return {
      id: hash(experiment.id).slice(0, 24),
      experimentId,
      title: `场景 ${String(index + 1).padStart(2, '0')}`,
      questions: experiment.questions,
      candidates: experiment.candidates.map((c) => {
        const run = c.runId ? store.db.run(c.runId) : undefined;
        const text = run?.creative?.result?.draftId
          ? drafts.readDraft(run.creative.result.draftId).content
          : c.text;
        if (text !== c.text && !c.text.includes(text)) throw new Error('试读正文已修改，请重新登记样稿');
        return { candidateId: c.id, text, hash: hash(text) };
      })
    };
  });
  const packet = registerReviewPacket(store, cases);
  return { packetId: packet.id, html: renderReviewPage(publicReviewPacket(packet)) };
}

export function importReviewFeedback(store: FileStore, expectedRevision: number, raw: unknown) {
  const feedback = reviewFeedbackSchema.parse(raw);
  const receiptHash = fingerprint({
    ...feedback,
    exportedAt: undefined,
    observations: feedback.observations.map(({ submittedAt, ...observation }) => observation)
  });
  return store.db.transaction(() => {
    const state = readQuality(store);
    const prior = state.reviewImports.find((r) => r.hash === receiptHash);
    if (prior) return { state, imported: 0, duplicate: true };
    if (state.revision !== expectedRevision) throw new Error('记录已更新，请刷新后再导入');
    const packet = state.reviewPackets.find((p) => p.id === feedback.packetId);
    if (!packet) throw new Error('此反馈不属于当前作品导出的试读，请打开对应作品');
    if (feedback.origin === 'human_target_reader' && !feedback.recruitment.trim())
      throw new Error('目标读者反馈缺少读者来源');
    if (feedback.exportedAt < feedback.startedAt || feedback.startedAt < packet.createdAt)
      throw new Error('试读时间早于试读文件或时间顺序错误');
    if (
      new Set(feedback.presentations.map((p) => p.caseId)).size !== feedback.presentations.length ||
      feedback.presentations.length !== packet.cases.length ||
      new Set(feedback.observations.map((o) => o.caseId)).size !== feedback.observations.length
    )
      throw new Error('试读场景重复或缺失');
    const presentations = new Map<string, string>();
    for (const input of feedback.presentations) {
      const c = packet.cases.find((c) => c.id === input.caseId);
      if (
        !c ||
        input.order.length !== c.candidates.length ||
        new Set(input.order).size !== input.order.length ||
        input.order.some((h) => !c.candidates.some((v) => v.hash === h))
      )
        throw new Error('样稿版本或展示顺序不匹配');
      const order = input.order.map((h) => c.candidates.find((v) => v.hash === h)!.candidateId);
      let presentation = state.presentations.find(
        (p) => p.experimentId === c.experimentId && p.participant === feedback.participant
      );
      if (presentation && fingerprint(presentation.order) !== fingerprint(order))
        throw new Error('该读者已登记另一展示顺序，请使用原试读记录');
      if (!presentation) {
        presentation = {
          id: id(),
          experimentId: c.experimentId,
          participant: feedback.participant,
          order,
          createdAt: feedback.startedAt
        };
        state.presentations.push(presentation);
      }
      presentations.set(c.id, presentation.id);
    }
    const observationIds: string[] = [];
    for (const input of feedback.observations) {
      const c = packet.cases.find((c) => c.id === input.caseId),
        presentationId = presentations.get(input.caseId);
      if (
        !c ||
        !presentationId ||
        input.submittedAt < feedback.startedAt ||
        input.submittedAt > feedback.exportedAt
      )
        throw new Error('反馈场景或提交时间不匹配');
      const presentation = feedback.presentations.find((p) => p.caseId === c.id)!;
      const alias = /^[A-F]$/.test(input.choice) ? input.choice : '';
      if (alias && !presentation.order[alias.charCodeAt(0) - 65]) throw new Error('偏好指向未展示的样稿');
      for (const annotation of input.annotations) {
        const displayedHash = presentation.order[annotation.alias.charCodeAt(0) - 65];
        const candidate = c.candidates.find((v) => v.hash === displayedHash);
        if (
          !candidate ||
          annotation.hash !== candidate.hash ||
          Array.from(candidate.text).slice(annotation.start, annotation.end).join('') !== annotation.quote ||
          annotation.end > Array.from(candidate.text).length
        )
          throw new Error('标记原文、版本或位置不一致');
      }
      const observation = {
        presentationId,
        origin: feedback.origin,
        outcome: alias
          ? ('preferred' as const)
          : (input.choice as 'tie' | 'both_unsatisfactory' | 'abstained'),
        alias,
        reason: input.reason,
        nextQuestion: input.nextQuestion,
        reading: input.reading,
        annotations: input.annotations,
        recruitment: feedback.recruitment,
        excluded: '',
        createdAt: input.submittedAt
      };
      const existing = state.observations.find(
        (o) => o.presentationId === presentationId && o.state === 'active'
      );
      if (existing) {
        const { id: oldId, state: oldState, createdAt: oldTime, ...old } = existing;
        const { createdAt: newTime, ...current } = observation;
        if (fingerprint(old) !== fingerprint(current))
          throw new Error('该读者已有反馈，请先撤回原记录再导入修改');
        continue;
      }
      const row = { ...observation, id: id(), state: 'active' as const };
      state.observations.push(row);
      observationIds.push(row.id);
    }
    const receipt = {
      id: id(),
      hash: receiptHash,
      packetId: packet.id,
      participant: feedback.participant,
      createdAt: now(),
      observationIds
    };
    state.reviewImports.push(receipt);
    store.db.set(`review-import:${receipt.id}`, feedback);
    return {
      state: saveQuality(store, state),
      imported: observationIds.length,
      duplicate: observationIds.length === 0
    };
  });
}
