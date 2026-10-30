import type { QualityState } from '../shared/quality';

const origins = { human_author: '作者', human_target_reader: '目标读者', model_simulation: '模型模拟' };
const outcomes = { preferred: '已有偏好', tie: '平局', both_unsatisfactory: '都不满意', abstained: '弃权' };
export function ReviewObservations({
  state,
  experimentId,
  excludedCount,
  onWithdraw
}: {
  state: QualityState;
  experimentId: string;
  excludedCount: number;
  onWithdraw: (id: string) => void;
}) {
  const presentations = state.presentations.filter((p) => p.experimentId === experimentId);
  return (
    <details>
      <summary>反馈记录 · 排除 {excludedCount} 条</summary>
      <div className="quality-cards">
        {state.observations
          .filter((o) => presentations.some((p) => p.id === o.presentationId))
          .map((o) => (
            <article key={o.id}>
              <h3>
                {presentations.find((p) => p.id === o.presentationId)?.participant} · {origins[o.origin]}
              </h3>
              <p>{o.reason || outcomes[o.outcome]}</p>
              {o.nextQuestion && (
                <p>
                  <strong>期待：</strong>
                  {o.nextQuestion}
                </p>
              )}
              {o.reading && (
                <p>
                  <strong>阅读感受：</strong>
                  {o.reading}
                </p>
              )}
              {!!o.annotations.length && (
                <details>
                  <summary>原文标记 · {o.annotations.length} 处</summary>
                  {o.annotations.map((a, index) => (
                    <blockquote key={index}>
                      <p>{a.quote}</p>
                      <p>{a.note}</p>
                    </blockquote>
                  ))}
                </details>
              )}
              {o.excluded && <p>{o.excluded}</p>}
              <button disabled={o.state === 'withdrawn'} onClick={() => onWithdraw(o.id)}>
                {o.state === 'withdrawn' ? '已撤回' : '撤回反馈'}
              </button>
            </article>
          ))}
      </div>
    </details>
  );
}
