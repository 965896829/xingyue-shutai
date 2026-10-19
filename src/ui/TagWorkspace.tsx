import { invokeCommand } from '../shared/client';
import type { Invoke } from '../shared/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { createPlanningTextFormatter } from '../shared/planning-language';
import type { Snapshot, Run } from '../shared/types';
import {
  emptyTagInput,
  tagGroupNames,
  type PlanningReview,
  type TagInput,
  type TagCatalog
} from '../shared/tags';
import './tags.css';
import { approvedCreation, planKinds, payoffStages } from '../shared/creation';
import { TitleWorkspace } from './TitleWorkspace';
import { creationStep, creationValidationIssues } from '../shared/run-presentation';
import { CreationTaskStatus, CreationChecks, type CreationCheckItem } from './CreationTaskStatus';

const invoke: Invoke = (command, args) => invokeCommand(command, args);
export const cleanTagInput = (input: TagInput): TagInput => ({
  selection: input.selection,
  premise: input.premise,
  mustKeep: input.mustKeep.map((v) => v.trim()).filter(Boolean),
  mustAvoid: input.mustAvoid.map((v) => v.trim()).filter(Boolean)
});
export function TagForm({
  value,
  onChange,
  disabled = false,
  showPremise = true,
  optionalTags = false
}: {
  value: TagInput;
  onChange: (input: TagInput) => void;
  disabled?: boolean;
  showPremise?: boolean;
  optionalTags?: boolean;
}) {
  const [catalog, setCatalog] = useState<TagCatalog | null>(null),
    [query, setQuery] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void invoke('tags.catalog')
      .then((v) => {
        if (active) setCatalog(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  if (error) return <p role="alert">标签库加载失败：{error}</p>;
  if (!catalog) return <p>正在加载标签…</p>;
  const choose = (section: 'reading' | 'content', field: string, id: string, max: number) => {
    const next = structuredClone(value),
      block = next.selection[section] as Record<string, string | string[]>;
    if (field === 'main') {
      if (!id && optionalTags) next.selection = emptyTagInput().selection;
      else block[field] = id;
    } else {
      const selected = block[field] as string[];
      block[field] = selected.includes(id)
        ? selected.filter((v) => v !== id)
        : selected.length < max
          ? [...selected, id]
          : selected;
    }
    onChange(next);
  };
  return (
    <div className="tag-form">
      {showPremise && (
        <label>
          创作想法（与标签至少提供一项）
          <textarea
            rows={3}
            disabled={disabled}
            value={value.premise}
            onChange={(e) => onChange({ ...value, premise: e.target.value })}
          />
        </label>
      )}
      <label>
        主分类
        <select
          required={!optionalTags}
          aria-label="主分类"
          disabled={disabled}
          value={value.selection.reading.main}
          onChange={(e) => choose('reading', 'main', e.target.value, 1)}
        >
          <option value="">{optionalTags ? '不使用平台标签，按创意策划' : '请选择一个主分类'}</option>
          {catalog.options
            .filter((o) => o.group === 'reading.main')
            .map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
        </select>
      </label>
      <details>
        <summary>补充标签与创作要求（选填）</summary>
        <label>
          查找标签
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按名称查找；同名跨组分别保留"
          />
        </label>
        {catalog.groups
          .filter((g) => g.id !== 'reading.main')
          .map((g) => {
            const [section, field] = g.id.split('.') as ['reading' | 'content', string];
            const selected = (value.selection[section] as Record<string, string[]>)[field];
            return (
              <details key={g.id} open={query ? true : undefined}>
                <summary>
                  {tagGroupNames[g.id]}{' '}
                  <span>
                    {selected.length} / {g.max}
                  </span>{' '}
                  {catalog.options
                    .filter((o) => selected.includes(o.id))
                    .map((o) => o.label)
                    .join('、')}
                </summary>
                <div className="tag-options">
                  {catalog.options
                    .filter(
                      (o) =>
                        o.group === g.id && (!query || o.label.includes(query) || selected.includes(o.id))
                    )
                    .map((o) => (
                      <label key={o.id} title={o.editorialFlags.join('；')}>
                        <input
                          type="checkbox"
                          checked={selected.includes(o.id)}
                          disabled={
                            disabled ||
                            (optionalTags && !value.selection.reading.main) ||
                            (!selected.includes(o.id) && selected.length >= g.max)
                          }
                          onChange={() => choose(section, field, o.id, g.max)}
                        />
                        {o.label}
                        {o.editorialFlags.length > 0 ? '（待核对）' : ''}
                      </label>
                    ))}
                </div>
              </details>
            );
          })}
        <label>
          必须保留（每行一项）
          <textarea
            rows={2}
            disabled={disabled}
            value={value.mustKeep.join('\n')}
            onChange={(e) => onChange({ ...value, mustKeep: e.target.value.split('\n') })}
          />
        </label>
        <label>
          不能出现（每行一项）
          <textarea
            rows={2}
            disabled={disabled}
            value={value.mustAvoid.join('\n')}
            onChange={(e) => onChange({ ...value, mustAvoid: e.target.value.split('\n') })}
          />
        </label>
        <details>
          <summary>标签资料说明</summary>
          <p>
            共 482
            项标签。阅读标签选择上限有官方公开说明；内容标签为提供的快照，未核对实时后台。详细知识仍为草案。
          </p>
        </details>
      </details>
    </div>
  );
}
export function TagWorkspace({
  snapshot,
  profileId,
  setProfileId,
  refresh,
  onReview,
  onAccept
}: {
  snapshot: Snapshot;
  profileId: string;
  setProfileId: (id: string) => void;
  refresh: () => Promise<void>;
  onReview: (id: string) => void;
  onAccept: (run: Run, startNext: boolean, warningReason: string) => Promise<void>;
}) {
  const p = snapshot.project!,
    draft = snapshot.tagDraft,
    accepted = approvedCreation(p);
  const [input, setInput] = useState<TagInput>(draft ? cleanTagInput(draft) : emptyTagInput());
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [note, setNote] = useState('');
  const [direction, setDirection] = useState(''),
    [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [rework, setRework] = useState(''),
    [reviewReason, setReviewReason] = useState('');
  const [coverage, setCoverage] = useState<any>(null),
    [diff, setDiff] = useState<any>(null);
  const [inputOpen, setInputOpen] = useState(!snapshot.runs.some((r) => r.planning) && !accepted);
  const [viewedStep, setViewedStep] = useState<1 | 2 | 3>(1),
    [continueAfterSave, setContinueAfterSave] = useState(true);
  const inputRef = useRef<HTMLDetailsElement>(null),
    flowRef = useRef<HTMLDivElement>(null);
  const run = snapshot.runs.find(
    (r) =>
      r.planning &&
      (!draft || r.planning.spec.inputHash === draft.inputHash) &&
      !r.accepted &&
      !['discarded', 'stale'].includes(r.status)
  );
  const t = run?.planning,
    report = t?.report,
    currentStep = creationStep(run);
  const showText = useMemo(
    () =>
      createPlanningTextFormatter({
        report,
        knowledge: t?.knowledge,
        candidate: t?.candidate,
        resolutions: t?.resolutions
      }),
    [report, t?.knowledge, t?.candidate, t?.resolutions]
  );
  const showAccepted = useMemo(
    () =>
      createPlanningTextFormatter({
        knowledge: accepted?.knowledge,
        candidate: accepted?.contract,
        resolutions: accepted?.contract.resolutions
      }),
    [accepted]
  );
  const showPrevious = useMemo(
    () =>
      createPlanningTextFormatter({
        knowledge: diff?.before?.knowledge,
        candidate: diff?.before?.contract,
        resolutions: diff?.before?.contract.resolutions
      }),
    [diff]
  );
  const running = !!snapshot.chatBusy || snapshot.runs.some((r) => r.status === 'running');
  const assumptions =
    report?.assumptions.filter((a) => !a.directionIds.length || a.directionIds.includes(direction)) ?? [];
  useEffect(() => {
    if (draft)
      setInput({
        selection: structuredClone(draft.selection),
        premise: draft.premise,
        mustKeep: [...draft.mustKeep],
        mustAvoid: [...draft.mustAvoid]
      });
    setCoverage(null);
  }, [draft?.inputHash]);
  useEffect(() => {
    setDirection(t?.selectedDirectionId || report?.recommendedDirectionId || '');
    setResolutions({});
    setReviewReason('');
    setDiff(null);
  }, [run?.id, t?.reportHash]);
  useEffect(() => {
    setViewedStep(currentStep);
    if (run) {
      setInputOpen(false);
      flowRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [run?.id, currentStep]);
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
  const saved =
    !!draft &&
    (!run || run.baseRevision === p.revision) &&
    draft.preferences.targetWords === p.config.targetWords &&
    draft.preferences.pov === p.config.pov &&
    draft.preferences.style === p.config.style &&
    draft.preferences.constraints === p.config.constraints &&
    JSON.stringify(cleanTagInput(input)) === JSON.stringify(cleanTagInput(draft));
  const editInput = () => {
    setInputOpen(true);
    requestAnimationFrame(() => {
      inputRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      inputRef.current?.querySelector('textarea')?.focus({ preventScroll: true });
    });
  };
  const startPlanning = () =>
    act(async () => {
      const current = saved
        ? draft!
        : await invoke('creation.saveDraft', {
            input: cleanTagInput(input),
            expectedRevision: draft?.revision ?? 0
          });
      await invoke('creation.start', {
        inputHash: current.inputHash,
        profileId,
        requestId: crypto.randomUUID()
      });
      setInputOpen(false);
    });
  const confirmPlan = (generateTitles: boolean) =>
    act(async () => {
      await invoke('creation.confirmPlan', {
        id: run!.id,
        proposalHash: run!.proposalHash!,
        warningReason: reviewReason
      });
      if (generateTitles) {
        const latest = await invoke('app.snapshot');
        const approval = latest.runs.find((r) => r.id === run!.id)?.planning?.planApproval;
        if (!approval) throw new Error('作品方案确认状态尚未取得，请刷新后在书名步骤继续。');
        await invoke('titles.start', {
          sourceRunId: run!.id,
          planHash: approval.planHash,
          profileId,
          rule: 'local',
          requestId: crypto.randomUUID()
        });
      }
    });
  const reviewItems = (issues: PlanningReview['issues'] = []): CreationCheckItem[] =>
    issues.map((i) => ({
      text: showText(i.explanation),
      fix: showText(i.suggestedFix),
      kind: i.severity === 'minor' ? 'suggestion' : 'blocking'
    }));
  const validationIssues = creationValidationIssues(run);
  const validationItems: CreationCheckItem[] = validationIssues.map((i) => ({
    text: showText(i.message),
    kind: i.severity === 'error' ? 'blocking' : i.severity === 'warning' ? 'confirmation' : 'suggestion'
  }));
  const needsReason = validationIssues.some((i) => i.severity === 'warning');
  const canAccept =
    t?.phase === 'ready' &&
    !busy &&
    !running &&
    saved &&
    !run?.issues.some((i) => i.severity === 'error') &&
    (!needsReason || !!reviewReason.trim()) &&
    (t.workflowVersion !== 2 || (!!t.planApproval && (!p.titlePending || !!t.titleSelection)));
  const steps =
    t?.workflowVersion === 2 || !run
      ? ['选方向', '确认方案', p.stage === 'S01' ? '定书名并开书' : '书名与保存']
      : ['选方向', '确认方案'];
  const selectedDirection = report?.directions.find((d) => d.id === (t?.selectedDirectionId || direction));
  return (
    <section className="tag-workspace">
      <header className="creation-header">
        <div>
          <h1>{p.stage === 'S01' ? '准备你的新作品' : '调整作品方案'}</h1>
          <p className="muted">
            {accepted
              ? '修改方案后，先核对变化，再保存为新的创作约定。'
              : p.stage === 'S01'
                ? '先选故事方向，再确定方案和书名。进度会自动保留。'
                : '先核对已有设定，保存后保持当前章节和阶段。'}
          </p>
        </div>
        <button onClick={editInput} disabled={busy || running}>
          {run || accepted ? '修改想法与标签' : '填写创作想法'}
        </button>
      </header>
      {error && (
        <div className="creation-action-error" role="alert">
          {error}
        </div>
      )}
      {note && (
        <p className="muted" role="status">
          {note}
        </p>
      )}
      <details
        ref={inputRef}
        className="creation-input"
        open={inputOpen}
        onToggle={(e) => setInputOpen(e.currentTarget.open)}
      >
        <summary>{run || accepted ? '开书想法、标签与模型' : '从你的想法开始'}</summary>
        <TagForm value={input} onChange={setInput} disabled={running || busy} optionalTags />
        <label className="creation-model">
          使用模型
          <select
            aria-label="策划模型"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            disabled={busy || running}
          >
            <option value="">选择模型</option>
            {snapshot.profiles
              .filter((v) => v.protocol !== 'images')
              .map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.model}
                </option>
              ))}
          </select>
        </label>
        <details>
          <summary>标签资料与单独保存</summary>
          <div className="tag-actions">
            <button
              disabled={busy || running}
              onClick={() =>
                void act(async () => {
                  await invoke('creation.saveDraft', {
                    input: cleanTagInput(input),
                    expectedRevision: draft?.revision ?? 0
                  });
                  setNote('想法已保存，可以按新输入开始策划。');
                })
              }
            >
              只保存输入
            </button>
            <button
              disabled={busy || !input.selection.reading.main}
              onClick={() =>
                void act(async () =>
                  setCoverage(await invoke('tags.validate', { input: cleanTagInput(input) }))
                )
              }
            >
              查看标签资料
            </button>
          </div>
          {coverage && (
            <ul>
              {coverage.coverage.map((c: any) => (
                <li key={c.optionId}>
                  {coverage.options.find((o: any) => o.id === c.optionId)?.label}：
                  {c.level === 'registry_only'
                    ? '详细资料待完善'
                    : c.level === 'genre_draft'
                      ? '题材基线草案'
                      : '详细知识草案'}
                </li>
              ))}
            </ul>
          )}
        </details>
        {(!run || !saved) && (
          <div className="tag-actions">
            <button
              className="primary"
              disabled={busy || running || !profileId}
              onClick={() => void startPlanning()}
            >
              {run ? '按新想法重新策划' : '生成三个故事方向'}
            </button>
            {!profileId && <span className="muted">请先选择模型</span>}
          </div>
        )}
      </details>
      {run && !saved && (
        <div className="creation-input-changed">
          <p>输入或作品配置已改动，当前方案需要重新策划。</p>
          <button
            className="primary"
            disabled={busy || running || !profileId}
            onClick={() => void startPlanning()}
          >
            按新输入重新策划
          </button>
          <button disabled={busy || running} onClick={editInput}>
            查看修改
          </button>
        </div>
      )}
      {run && t && (
        <div ref={flowRef} className="creation-flow">
          <nav className="creation-steps" aria-label="开书步骤">
            {steps.map((label, index) => (
              <button
                key={label}
                disabled={index + 1 > currentStep}
                aria-current={viewedStep === index + 1 ? 'step' : undefined}
                className={index + 1 < currentStep ? 'completed' : ''}
                onClick={() => setViewedStep((index + 1) as 1 | 2 | 3)}
              >
                <span>{index + 1 < currentStep ? '✓' : index + 1}</span>
                <b>{label}</b>
              </button>
            ))}
          </nav>
          {viewedStep < currentStep && (
            <div className="creation-revisit">
              <span>正在回看已完成的步骤</span>
              <button onClick={() => setViewedStep(currentStep)}>回到当前步骤</button>
            </div>
          )}
          {viewedStep === currentStep && currentStep !== 3 && (
            <CreationTaskStatus
              run={run}
              disabled={busy || (running && run.status !== 'running')}
              act={act}
              onReview={onReview}
              onEdit={editInput}
              format={showText}
            />
          )}
          {viewedStep === 1 && (
            <div className="creation-step-content" aria-label="选择故事方向">
              {report && (
                <>
                  <div className="creation-step-heading">
                    <h2>你想写哪一个故事？</h2>
                    <p className="muted">{showText(report.positioning)}</p>
                  </div>
                  <div className="tag-directions">
                    {report.directions.map((d) => (
                      <article
                        key={d.id}
                        className={(t.selectedDirectionId || direction) === d.id ? 'selected' : ''}
                      >
                        {report.recommendedDirectionId === d.id && (
                          <span className="creation-badge">推荐方向</span>
                        )}
                        <h3>{showText(d.title)}</h3>
                        <p>{showText(d.logline)}</p>
                        <dl>
                          <dt>故事如何展开</dt>
                          <dd>{showText(d.storyEngine)}</dd>
                          <dt>与其他方向的区别</dt>
                          <dd>{showText(d.differenceFromOtherDirections)}</dd>
                        </dl>
                        <details>
                          <summary>开篇、首卷与长期发展</summary>
                          <dl>
                            <dt>开篇选择</dt>
                            <dd>{showText(d.openingDecision)}</dd>
                            <dt>首卷变化</dt>
                            <dd>{showText(d.firstVolumeChange)}</dd>
                            <dt>长期风险</dt>
                            <dd>{showText(d.longRunRisk)}</dd>
                          </dl>
                          {d.intentChanges.length > 0 && (
                            <p>对原想法的调整：{showText(d.intentChanges.join('；'))}</p>
                          )}
                          {d.tagCoverage.map((v) => (
                            <p key={v.optionId}>
                              <b>{t.knowledge.options.find((o) => o.id === v.optionId)?.label}</b>：
                              {showText(v.implementation)}
                              <br />
                              首次展示：{showText(v.firstDemonstration)}
                              <br />
                              风险：{showText(v.risk)}
                            </p>
                          ))}
                        </details>
                        <button
                          disabled={busy || running || t.phase !== 'awaiting_direction'}
                          aria-pressed={(t.selectedDirectionId || direction) === d.id}
                          onClick={() => setDirection(d.id)}
                        >
                          {(t.selectedDirectionId || direction) === d.id ? '已选这个方向' : '选择这个方向'}
                        </button>
                      </article>
                    ))}
                  </div>
                  <details className="creation-background">
                    <summary>推荐理由与方向检查</summary>
                    <p>{showText(report.recommendationReasons.join('；'))}</p>
                    {report.diagnosis.map((v, i) => (
                      <p key={i}>{showText(v.message)}</p>
                    ))}
                  </details>
                  <CreationChecks title="方向检查" items={reviewItems(t.reportReview?.result.issues)} />
                </>
              )}
              {t.phase === 'awaiting_direction' && selectedDirection && (
                <div className="tag-confirm">
                  <h3>为「{showText(selectedDirection.title)}」完善方案</h3>
                  {assumptions.length > 0 && (
                    <>
                      <p>这个方向还会采用以下设定。继续即确认这些设定；需要调整时，可直接补充意见。</p>
                      {assumptions.map((a) => (
                        <div className="creation-assumption" key={a.id}>
                          <p>{showText(a.text)}</p>
                          <details>
                            <summary>我想调整这项设定</summary>
                            <label>
                              修改意见
                              <textarea
                                placeholder="写下你的调整要求"
                                value={resolutions[a.id] ?? ''}
                                onChange={(e) => setResolutions({ ...resolutions, [a.id]: e.target.value })}
                              />
                            </label>
                          </details>
                        </div>
                      ))}
                    </>
                  )}
                  <details>
                    <summary>重新构思这个方向</summary>
                    <label>
                      希望怎样调整
                      <textarea
                        value={rework}
                        onChange={(e) => setRework(e.target.value)}
                        placeholder="其他两个方向会保留"
                      />
                    </label>
                    <button
                      disabled={busy || running || !saved || !rework.trim()}
                      onClick={() =>
                        void act(() =>
                          invoke('tags.reviseDirection', {
                            id: run.id,
                            directionId: direction,
                            reportHash: t.reportHash!,
                            instruction: rework
                          })
                        )
                      }
                    >
                      按要求重做这个方向
                    </button>
                  </details>
                  <div className="creation-next">
                    <span>下一步：查看完整作品方案</span>
                    <button
                      className="primary"
                      disabled={busy || running || !saved}
                      onClick={() =>
                        void act(() =>
                          invoke('tags.selectDirection', {
                            id: run.id,
                            directionId: direction,
                            reportHash: t.reportHash!,
                            acceptAssumptions: true,
                            resolutions: Object.fromEntries(
                              assumptions
                                .filter((a) => resolutions[a.id]?.trim())
                                .map((a) => [a.id, resolutions[a.id].trim()])
                            )
                          })
                        )
                      }
                    >
                      {assumptions.some((a) => resolutions[a.id]?.trim())
                        ? '按修改意见完善方案'
                        : '按这个方向完善方案'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {viewedStep === 2 && (
            <div className="creation-step-content" aria-label="确认作品方案">
              {selectedDirection && (
                <p className="creation-direction-summary">
                  故事方向：<strong>{showText(selectedDirection.title)}</strong>
                  <button onClick={() => setViewedStep(1)}>回看方向</button>
                </p>
              )}
              {t.candidate?.plan && (
                <div className="creation-plan" aria-label="完整作品方案">
                  <h2>这就是你的作品方案</h2>
                  <p className="muted">确认故事机制、人物目标和边界，再为它确定书名。</p>
                  {t.candidate.plan.statements.map((statement) => (
                    <div key={statement.id}>
                      <h3>
                        {planKinds[statement.kind]} <small>{payoffStages[statement.payoffStage]}</small>
                      </h3>
                      <p>{showText(statement.text)}</p>
                    </div>
                  ))}
                  {t.candidate.plan.tagRoles.length > 0 && (
                    <details>
                      <summary>标签在本书中的分工</summary>
                      {t.candidate.plan.tagRoles.map((role) => (
                        <p key={role.optionId}>
                          <b>{t.knowledge.options.find((o) => o.id === role.optionId)?.label}</b>：
                          {showText(role.implementation)}
                        </p>
                      ))}
                    </details>
                  )}
                </div>
              )}
              {t.candidate && (
                <details className="creation-background" open={!t.candidate.plan}>
                  <summary>{t.origin === 'new' ? '查看完整设定拆解与约定' : '查看调整后的创作约定'}</summary>
                  {t.origin === 'new' && (
                    <div
                      className="markdown-preview"
                      onClick={(event) => {
                        const anchor = (event.target as HTMLElement).closest('a');
                        if (anchor) {
                          event.preventDefault();
                          const url = anchor.getAttribute('href') ?? '';
                          if (/^https?:\/\//i.test(url)) void act(() => invoke('app.openUrl', { url }));
                        }
                      }}
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(
                          marked.parse(showText(t.candidate.premiseDocument), { async: false }) as string,
                          { FORBID_TAGS: ['img', 'style', 'iframe'] }
                        )
                      }}
                    />
                  )}
                  {t.candidate.constraints.map((v) => (
                    <p key={v.id}>{showText(v.text)}</p>
                  ))}
                  {t.candidate.openQuestions.length > 0 && (
                    <p>尚待明确：{showText(t.candidate.openQuestions.join('；'))}</p>
                  )}
                </details>
              )}
              <CreationChecks title="方案检查" items={reviewItems(t.contractReview?.result.issues)} />
              {t.phase === 'ready' && <CreationChecks title="保存前核对" items={validationItems} />}
              {t.phase === 'ready' && needsReason && (
                <label className="creation-review-reason">
                  请说明保留上述提醒的原因
                  <textarea value={reviewReason} onChange={(event) => setReviewReason(event.target.value)} />
                </label>
              )}
              {t.phase === 'ready' && t.workflowVersion === 2 && !t.planApproval && (
                <div className="creation-next">
                  <div>
                    <span>
                      {p.titlePending && run.mode === 'stage'
                        ? '下一步：根据方案生成书名，供你选择'
                        : '下一步：核对书名并保存方案'}
                    </span>
                    {p.titlePending && run.mode === 'stage' && (
                      <button
                        className="text-button"
                        disabled={
                          busy ||
                          running ||
                          !saved ||
                          run.issues.some((i) => i.severity === 'error') ||
                          (needsReason && !reviewReason.trim())
                        }
                        onClick={() => void confirmPlan(false)}
                      >
                        我想自己取名，先进入下一步
                      </button>
                    )}
                  </div>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      running ||
                      !saved ||
                      !profileId ||
                      run.issues.some((i) => i.severity === 'error') ||
                      (needsReason && !reviewReason.trim())
                    }
                    onClick={() => void confirmPlan(!!p.titlePending && run.mode === 'stage')}
                  >
                    {p.titlePending && run.mode === 'stage' ? '确认方案并生成书名' : '确认方案，下一步'}
                  </button>
                </div>
              )}
            </div>
          )}
          {viewedStep === 3 && t.planApproval && (
            <>
              <TitleWorkspace
                key={run.id + '-' + t.planApproval.hash}
                snapshot={snapshot}
                sourceRunId={run.id}
                profileId={profileId}
                refresh={refresh}
                onReview={onReview}
                disabled={!saved || busy}
              />
              <CreationChecks title="保存前核对" items={validationItems} />
              {needsReason && (
                <label className="creation-review-reason">
                  请说明保留上述提醒的原因
                  <textarea value={reviewReason} onChange={(e) => setReviewReason(e.target.value)} />
                </label>
              )}
            </>
          )}
          {t.phase === 'ready' && (viewedStep === 3 || (t.workflowVersion !== 2 && viewedStep === 2)) && (
            <div className="creation-next creation-final">
              <div>
                {t.titleSelection ? (
                  <p>
                    将以「<strong>{t.titleSelection.candidate.title}</strong>」保存已确认的作品方案。
                  </p>
                ) : (
                  <p>
                    {p.titlePending && t.workflowVersion === 2
                      ? '选好书名后，即可保存作品方案。'
                      : '保存已确认的作品方案与创作约定。'}
                  </p>
                )}
                {run.mode === 'stage' && (
                  <label>
                    <input
                      type="checkbox"
                      checked={continueAfterSave}
                      onChange={(e) => setContinueAfterSave(e.target.checked)}
                      disabled={busy || running}
                    />
                    保存后继续生成“项目与文风”
                  </label>
                )}
              </div>
              <button
                className="primary"
                disabled={!canAccept}
                onClick={() =>
                  void act(() => onAccept(run, run.mode === 'stage' && continueAfterSave, reviewReason))
                }
              >
                {t.workflowVersion !== 2 && p.titlePending
                  ? '确认方案并确定书名'
                  : run.mode !== 'stage'
                    ? '保存方案并核对后续影响'
                    : continueAfterSave
                      ? '确认书名并继续'
                      : '确认书名并保存'}
              </button>
            </div>
          )}
          <details className="creation-background">
            <summary>任务记录与其他操作</summary>
            <div className="tag-actions">
              <button disabled={busy} onClick={() => onReview(run.id)}>
                查看任务记录与文件差异
              </button>
              <button
                disabled={busy || running}
                onClick={() => void act(async () => setDiff(await invoke('tags.diff', { id: run.id })))}
              >
                查看约定变化与影响
              </button>
              <button
                disabled={busy || running}
                onClick={() => void act(() => invoke('run.discard', { id: run.id }))}
              >
                放弃此方案
              </button>
            </div>
          </details>
          {diff && (
            <details open className="creation-background">
              <summary>创作约定变化与影响</summary>
              <div className="tag-diff">
                <div>
                  <h3>原约定</h3>
                  {diff.before?.contract.constraints.map((v: any) => (
                    <p key={v.id}>{showPrevious(v.text)}</p>
                  )) ?? '尚无已采纳的创作约定'}
                </div>
                <div>
                  <h3>拟定约定</h3>
                  {diff.after?.constraints.map((v: any) => (
                    <p key={v.id}>{showText(v.text)}</p>
                  ))}
                </div>
              </div>
              {t.origin !== 'new' && (
                <p>
                  采纳后需核对：{diff.affected.map((v: any) => v.path).join('、') || '无已有下游产物'}
                  。已有正文不会自动改写。
                </p>
              )}
            </details>
          )}
        </div>
      )}
      {!run && accepted?.contract.plan && (
        <TitleWorkspace
          key={'formal-' + accepted.contract.planHash}
          snapshot={snapshot}
          profileId={profileId}
          refresh={refresh}
          onReview={onReview}
        />
      )}
      {accepted && (
        <details className="creation-background">
          <summary>当前已生效的创作约定</summary>
          {accepted.contract.plan?.statements.map((v) => (
            <p key={v.id}>
              <b>{planKinds[v.kind]}</b>：{showAccepted(v.text)}
            </p>
          ))}
          {accepted.contract.constraints.map((v) => (
            <p key={v.id}>{showAccepted(v.text)}</p>
          ))}
          {snapshot.documents.some(
            (d) => d.path === '02_项目配置/标签创作契约.md' && d.status !== 'accepted'
          ) && (
            <button
              disabled={busy || running}
              onClick={() =>
                void act(() =>
                  invoke('tags.restoreProjection', {
                    baseHash:
                      snapshot.documents.find((d) => d.path === '02_项目配置/标签创作契约.md')?.hash ?? null
                  })
                )
              }
            >
              从正式记录恢复展示文件
            </button>
          )}
        </details>
      )}
    </section>
  );
}
