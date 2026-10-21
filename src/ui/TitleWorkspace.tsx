import { useEffect, useState } from 'react';
import { invokeCommand as invoke } from '../shared/client';
import { approvedCreation, payoffStages, titleRules } from '../shared/creation';
import type { Snapshot } from '../shared/types';
import type { TitleStyleProfile } from '../shared/title-style';
import { CreationTaskStatus } from './CreationTaskStatus';
import { runHasCurrentBasis } from '../shared/run-presentation';

export function TitleWorkspace({
  snapshot,
  sourceRunId,
  profileId,
  refresh,
  onReview,
  disabled = false
}: {
  snapshot: Snapshot;
  sourceRunId?: string;
  profileId: string;
  refresh: () => Promise<void>;
  onReview: (id: string) => void;
  disabled?: boolean;
}) {
  const p = snapshot.project!,
    parent = snapshot.runs.find((r) => r.id === sourceRunId),
    creation = approvedCreation(p);
  const plan = sourceRunId ? parent?.planning?.candidate?.plan : creation?.contract.plan;
  const planHash = sourceRunId ? parent?.planning?.planApproval?.planHash : creation?.contract.planHash;
  const run = snapshot.runs.find(
    (r) =>
      r.naming &&
      r.naming.sourceRunId === sourceRunId &&
      runHasCurrentBasis(r, p) &&
      r.naming.planHash === planHash &&
      !r.accepted &&
      !['discarded', 'stale'].includes(r.status)
  );
  const t = run?.naming;
  const selected = sourceRunId ? parent?.planning?.titleSelection : p.titleBinding;
  const [manual, setManual] = useState(sourceRunId && parent?.planning?.origin !== 'new' ? p.title : '');
  const [rule, setRule] = useState<keyof typeof titleRules>('local');
  const [instruction, setInstruction] = useState(''),
    [rework, setRework] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [styleProfile, setStyleProfile] = useState<TitleStyleProfile | null>(null);
  const [styleError, setStyleError] = useState('');
  useEffect(() => {
    let active = true;
    void invoke('titles.styleProfile').then(value => {
      if (active) setStyleProfile(value);
    }).catch(e => { if (active) setStyleError((e as Error).message); });
    return () => { active = false; };
  }, []);
  const running = snapshot.chatBusy || snapshot.runs.some((r) => r.status === 'running');
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      try {
        await refresh();
      } catch (e) {
        setError((previous) => previous || (e as Error).message);
      }
      setBusy(false);
    }
  };
  if (!plan || !planHash) return null;
  return (
    <section className="title-workspace" aria-label="独立命名">
      <h2>{sourceRunId ? '为这个故事选一个书名' : '作品书名'}</h2>
      <p className="muted">
        {sourceRunId
          ? '书名根据已确认的方案生成。选好后，在下方保存作品。'
          : '根据当前作品方案生成或核对书名。'}
        每轮生成六个候选；再次生成时参考同一方案的命名历史。
      </p>
      {styleProfile && (
        <details className="title-style-reference">
          <summary>番茄命名参考 · {styleProfile.verifiedAt}</summary>
          <p className="muted">{styleProfile.scope}</p>
          {styleProfile.examples.map(example => (
            <p key={example.url}>
              <a href={example.url} target="_blank" rel="noreferrer">《{example.title}》</a>：{example.patternNote}
            </p>
          ))}
          <p className="muted">参考命名方式，具体承诺以你的作品方案为准。可在下方补充长名、短名和卖点偏好。</p>
        </details>
      )}
      {styleError && <p role="alert" className="creation-action-error">命名参考加载失败：{styleError}</p>}
      {p.titleReviewRequired && !sourceRunId && (
        <p className="inline-warning" role="status">
          作品方案已改变，请核对当前书名「{p.title}」是否仍与内容一致。可以填写原书名进行核对，无需一定改名。
        </p>
      )}
      {selected && (
        <p className="title-selection" role="status">
          {sourceRunId ? '本阶段已选书名' : '当前正式书名'}：<strong>{selected.candidate.title}</strong>
          {!sourceRunId && p.titleBinding?.needsReview ? ' · 待核对' : ''}
        </p>
      )}
      {error && (
        <p className="creation-action-error" role="alert">
          {error}
        </p>
      )}
      {!sourceRunId &&
        p.titleBinding &&
        snapshot.documents.some(
          (d) => d.path === '02_项目配置/书名与入口承诺.md' && d.status !== 'accepted'
        ) && (
          <button
            disabled={busy || running}
            onClick={() =>
              void act(() =>
                invoke('titles.restoreProjection', {
                  baseHash:
                    snapshot.documents.find((d) => d.path === '02_项目配置/书名与入口承诺.md')?.hash ?? null
                })
              )
            }
          >
            从正式命名记录恢复展示文件
          </button>
        )}
      <details className="title-options" open={!run && !selected}>
        <summary>{run || selected ? '自己取名、调整要求或再生成一组' : '书名与生成要求'}</summary>
        <div className="title-settings">
          <label>
            命名场景
            <select
              aria-label="命名场景"
              value={rule}
              disabled={busy || running || disabled}
              onChange={(e) => setRule(e.target.value as keyof typeof titleRules)}
            >
              {Object.entries(titleRules).map(([id, value]) => (
                <option key={id} value={id}>
                  {value.label} · 最多{value.maxCharacters}字符
                </option>
              ))}
            </select>
          </label>
          <label>
            我已有书名（选填）
            <input
              aria-label="我已有书名"
              maxLength={80}
              value={manual}
              disabled={busy || running || disabled}
              placeholder="填写后核对这个名字；留空则生成候选"
              onChange={(e) => setManual(e.target.value)}
            />
          </label>
          <details>
            <summary>补充命名要求</summary>
            <textarea
              aria-label="补充命名要求"
              value={instruction}
              maxLength={6000}
              onChange={(e) => setInstruction(e.target.value)}
              disabled={busy || running || disabled}
              placeholder="例如：优先短书名，突出职业与行动"
            />
          </details>
        </div>
        <button
          className={!run ? 'primary' : undefined}
          disabled={busy || running || disabled || !profileId}
          onClick={() =>
            void act(() =>
              invoke('titles.start', {
                sourceRunId,
                planHash,
                profileId,
                rule,
                requestId: crypto.randomUUID(),
                instruction,
                ...(manual.trim() ? { manualTitle: manual.trim() } : {})
              })
            )
          }
        >
          {manual.trim() ? '核对这个书名' : t ? '再生成一组书名' : '生成书名候选'}
        </button>
        <p className="muted">未进行平台全站查重。15 字符限制仅适用于“番茄多书名实验”场景。</p>
      </details>
      {run && t && (
        <>
          <CreationTaskStatus
            run={run}
            disabled={busy || disabled || (!!running && run.status !== 'running')}
            act={act}
            onReview={onReview}
          />
          <div className="title-candidates">
            {t.batch?.candidates.map((c) => {
              const decision = t.review?.result.decisions.find((v) => v.candidateId === c.id);
              const checked = t.phase === 'ready' && decision?.verdict === 'keep';
              return (
                <article
                  key={c.id}
                  className={
                    selected?.candidate.id === c.id && selected.batchRunId === run.id ? 'selected' : ''
                  }
                >
                  <h3>
                    {c.title}
                    {t.batch!.recommendedIds.includes(c.id) ? ' · 推荐' : ''}
                  </h3>
                  <p>
                    {c.angle} · {payoffStages[c.payoffStage]}
                  </p>
                  <p>{c.readerPromise}</p>
                  {decision && (
                    <p className={checked ? 'muted' : 'title-review-note'}>
                      {decision.verdict === 'keep'
                        ? '保留'
                        : decision.verdict === 'revise'
                          ? '需修改'
                          : '淘汰'}
                      ：{decision.reason}
                    </p>
                  )}
                  <details>
                    <summary>方案依据与命名建议</summary>
                    {c.riskNotes.map((note, index) => (
                      <p key={index}>{note}</p>
                    ))}
                    {c.supportingClaimIds.map((id) => (
                      <p key={id}>{plan.statements.find((v) => v.id === id)?.text ?? '依据已失效'}</p>
                    ))}
                  </details>
                  <button
                    className={sourceRunId ? undefined : 'primary'}
                    aria-pressed={
                      sourceRunId
                        ? selected?.candidate.id === c.id && selected.batchRunId === run.id
                        : undefined
                    }
                    disabled={!checked || busy || running || disabled}
                    onClick={() =>
                      void act(() =>
                        invoke('titles.select', { id: run.id, batchHash: t.review!.hash, candidateId: c.id })
                      )
                    }
                  >
                    {sourceRunId
                      ? selected?.candidate.id === c.id && selected.batchRunId === run.id
                        ? '已选这个书名'
                        : '选用这个书名'
                      : '确认并保存这个书名'}
                  </button>
                  <details>
                    <summary>只重做这个书名</summary>
                    <textarea
                      aria-label={`修改「${c.title}」的要求`}
                      value={rework[c.id] ?? ''}
                      onChange={(e) => setRework({ ...rework, [c.id]: e.target.value })}
                      maxLength={6000}
                    />
                    <button
                      disabled={busy || running || disabled || t.phase !== 'ready' || !rework[c.id]?.trim()}
                      onClick={() =>
                        void act(() =>
                          invoke('titles.regenerate', {
                            id: run.id,
                            batchHash: t.review!.hash,
                            candidateId: c.id,
                            instruction: rework[c.id].trim()
                          })
                        )
                      }
                    >
                      按要求重做并审核
                    </button>
                  </details>
                </article>
              );
            })}
          </div>
          <details>
            <summary>命名任务与历史</summary>
            <button onClick={() => onReview(run.id)}>查看任务、用量与恢复记录</button>
            {t.history.map((h, i) => (
              <p key={i}>
                历史第 {i + 1} 组：{h.batch.candidates.map((c) => c.title).join('、')}
              </p>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
