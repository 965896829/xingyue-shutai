import test from 'node:test';
import assert from 'node:assert/strict';
import { refactorFixture } from './fixtures/refactor';
import { mutateQuality, readQuality, qualityStatistics } from '../src/core/quality';
import { exportReviewPage, importReviewFeedback, publicReviewPacket } from '../src/core/blind-review';
import type { ReviewFeedback } from '../src/shared/blind-review';

function fixture() {
  const f = refactorFixture();
  const state = mutateQuality(f.store, 0, {
    kind: 'experiment',
    experiment: {
      title: '不应公开的试读题名',
      kind: 'voice_fixed_story',
      stage: 'holdout',
      family: 'private-family',
      sceneFunction: '对话',
      audience: '指定读者',
      variedFactors: ['voice'],
      constraints: '结尾保持不变',
      questions: ['更愿意继续阅读哪篇？']
    },
    candidates: [
      { text: '甲𠮷没有开门。', runId: '' },
      { text: '乙把伞收了起来。', runId: '' },
      { text: '屋外仍在下雨。', runId: '' }
    ]
  });
  const experimentId = state.experiments[0].id;
  const output = exportReviewPage(f.store, [experimentId]);
  const packet = readQuality(f.store).reviewPackets[0];
  const c = packet.cases[0],
    order = [...c.candidates].reverse().map((v) => v.hash);
  const at = (offset: number) => new Date(Date.parse(packet.createdAt) + offset).toISOString();
  const feedback: ReviewFeedback = {
    schemaVersion: 1,
    packetId: packet.id,
    participant: 'reader-1',
    origin: 'human_target_reader',
    recruitment: '测试夹具',
    startedAt: at(100),
    exportedAt: at(300),
    presentations: [{ caseId: c.id, order }],
    observations: [
      {
        caseId: c.id,
        choice: 'C',
        reason: '保留悬念',
        nextQuestion: '谁在门外',
        reading: '',
        annotations: [
          {
            alias: 'C',
            hash: order[2],
            start: 1,
            end: 2,
            coordinateUnit: 'unicode_codepoint',
            quote: '𠮷',
            note: '生僻字'
          }
        ],
        submittedAt: at(200)
      }
    ]
  };
  return { ...f, output, packet, feedback, experimentId };
}

test('试读导出隐藏内部映射，支持多样稿与原文版本固定', () => {
  const f = fixture();
  try {
    const publicPacket = publicReviewPacket(f.packet);
    const output = JSON.stringify(publicPacket);
    assert.doesNotMatch(output, /private-family|不应公开|experimentId|candidateId|provenance|runId/);
    assert.equal(publicPacket.cases[0].candidates.length, 3);
    assert.equal(exportReviewPage(f.store, [f.experimentId]).packetId, f.packet.id);
    assert.equal(readQuality(f.store).reviewPackets.length, 1);
    assert.match(f.output.html, /crypto.getRandomValues/);
  } finally {
    f.store.close();
  }
});

test('离线反馈按实际展示顺序归因，Unicode 引用、补充问题和重复导入保留', () => {
  const f = fixture();
  try {
    const result = importReviewFeedback(f.store, readQuality(f.store).revision, f.feedback);
    assert.equal(result.imported, 1);
    assert.equal(result.state.observations[0].annotations[0].quote, '𠮷');
    assert.equal(result.state.observations[0].nextQuestion, '谁在门外');
    const stats = qualityStatistics(f.store, f.experimentId);
    assert.equal(stats.strata[1].wins[result.state.experiments[0].candidates[0].id], 1);
    assert.equal(stats.strata[1].participants, 1);
    const duplicate = importReviewFeedback(f.store, 0, {
      ...f.feedback,
      exportedAt: new Date(Date.parse(f.feedback.exportedAt) + 100).toISOString(),
      observations: f.feedback.observations.map((o) => ({
        ...o,
        submittedAt: new Date(Date.parse(o.submittedAt) + 100).toISOString()
      }))
    });
    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.state.observations.length, 1);
    assert.ok(f.store.db.get(`review-import:${result.state.reviewImports[0].id}`));
  } finally {
    f.store.close();
  }
});

test('错版、越界原文、重复场景和空读者来源不能部分落库', () => {
  const f = fixture();
  try {
    const baseline = readQuality(f.store);
    const variations = [
      (v: ReviewFeedback) => {
        v.presentations[0].order[0] = 'f'.repeat(64);
      },
      (v: ReviewFeedback) => {
        v.observations[0].annotations[0].end = 3;
      },
      (v: ReviewFeedback) => {
        v.observations.push(structuredClone(v.observations[0]));
      },
      (v: ReviewFeedback) => {
        v.recruitment = '';
      },
      (v: ReviewFeedback) => {
        v.observations[0].choice = 'F';
      }
    ];
    for (const alter of variations) {
      const input = structuredClone(f.feedback);
      alter(input);
      assert.throws(() => importReviewFeedback(f.store, baseline.revision, input));
      assert.deepEqual(readQuality(f.store), baseline);
    }
    const other = refactorFixture();
    try {
      assert.throws(() => importReviewFeedback(other.store, 0, f.feedback), /不属于当前作品/);
    } finally {
      other.store.close();
    }
  } finally {
    f.store.close();
  }
});

test('模拟反馈不计为真人，修改先撤回，旧导入不会恢复已撤回反馈', () => {
  const f = fixture();
  try {
    f.feedback.origin = 'model_simulation';
    let result = importReviewFeedback(f.store, readQuality(f.store).revision, f.feedback);
    assert.equal(qualityStatistics(f.store, f.experimentId).strata[1].comparisons, 0);
    assert.equal(qualityStatistics(f.store, f.experimentId).strata[2].comparisons, 1);
    const revised = structuredClone(f.feedback);
    revised.observations[0].choice = 'tie';
    assert.throws(() => importReviewFeedback(f.store, result.state.revision, revised), /先撤回/);
    const state = mutateQuality(f.store, result.state.revision, {
      kind: 'withdraw',
      id: result.state.observations[0].id
    });
    importReviewFeedback(f.store, state.revision, {
      ...f.feedback,
      observations: f.feedback.observations.map((o) => ({
        ...o,
        submittedAt: new Date(Date.parse(o.submittedAt) + 50).toISOString()
      }))
    });
    assert.equal(qualityStatistics(f.store, f.experimentId).strata[2].comparisons, 0);
    result = importReviewFeedback(f.store, readQuality(f.store).revision, revised);
    assert.equal(result.state.observations.length, 2);
    assert.equal(qualityStatistics(f.store, f.experimentId).strata[2].ties, 1);
    const shuffled = structuredClone(revised);
    shuffled.presentations[0].order.reverse();
    assert.throws(() => importReviewFeedback(f.store, result.state.revision, shuffled), /另一展示顺序/);
  } finally {
    f.store.close();
  }
});

test('客户端反馈同样核对样稿版本和 Unicode 原文位置', () => {
  const f = fixture();
  try {
    const state = mutateQuality(f.store, readQuality(f.store).revision, {
      kind: 'present',
      experimentId: f.experimentId,
      participant: 'direct-reader'
    });
    const presentation = state.presentations[0];
    const candidate = state.experiments[0].candidates[0];
    const alias = String.fromCharCode(65 + presentation.order.indexOf(candidate.id));
    const observation = {
      presentationId: presentation.id,
      origin: 'model_simulation' as const,
      outcome: 'preferred' as const,
      alias,
      reason: '本地校验',
      nextQuestion: '',
      reading: '',
      recruitment: '',
      excluded: '',
      annotations: [
        {
          alias,
          hash: candidate.hash,
          start: 1,
          end: 2,
          coordinateUnit: 'unicode_codepoint' as const,
          quote: '𠮷',
          note: ''
        }
      ]
    };
    const invalid = structuredClone(observation);
    invalid.annotations[0].end = 3;
    assert.throws(
      () => mutateQuality(f.store, state.revision, { kind: 'feedback', observation: invalid }),
      /原文与展示样稿不一致/
    );
    assert.deepEqual(readQuality(f.store), state);
    const saved = mutateQuality(f.store, state.revision, { kind: 'feedback', observation });
    assert.equal(saved.observations[0].annotations[0].quote, '𠮷');
  } finally {
    f.store.close();
  }
});
