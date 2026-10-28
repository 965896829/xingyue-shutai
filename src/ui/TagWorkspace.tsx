import { ModelControl } from './ModelControl';
import { ContextMeter } from './ContextMeter';
import { latestContext } from '../shared/context-meter';
import { invokeCommand } from '../shared/client';
import type { Invoke } from '../shared/contracts';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownContent } from './MarkdownContent';
import { createPlanningTextFormatter } from '../shared/planning-language';
import { assessTagPolicy } from '../shared/tag-policy';
import type { Snapshot, Run } from '../shared/types';
import {
  emptyTagInput,
  tagGroupNames,
  type PlanningReview,
  type TagInput,
  type TagCatalog
} from '../shared/tags';
import { approvedCreation, planKinds, payoffStages } from '../shared/creation';
import { TitleWorkspace } from './TitleWorkspace';
import { DirectionCards } from './DirectionCards';
import { creationDirectionId, creationStep, creationValidationIssues, runHasCurrentBasis } from '../shared/run-presentation';
import { CreationTaskStatus, CreationChecks, type CreationCheckItem } from './CreationTaskStatus';
import { useWorkspaceAction } from './useWorkspaceAction';
import { handleMarkdownLink } from './markdown-links';

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
  const policy = assessTagPolicy(catalog, value.selection);
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
      </details>
      <details className="tag-policy">
        <summary>标签资料说明 · {policy.mode === 'creative' ? '自由创意' : '查看核对范围'}</summary>
        <p>{policy.message}</p>
        <p className="muted">
          本地标签快照共 {catalog.options.length} 项。资料范围：{policy.scope}。
          {policy.verifiedAt ? `公开资料核对日期：${policy.verifiedAt}。` : ''}
          内容标签的选择上限是本地配置，后台可用选项与组合条件仍需开书时核对。
        </p>
        {policy.checks.map((check) => (
          <p key={check.id}>
            <strong>{check.label}</strong>：{check.message}
          </p>
        ))}
        {policy.sources.filter((source) => source.url && /^https?:\/\//.test(source.url)).map((source) => (
          <p key={source.id}>
            <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
            {source.publishedAt ? `（${source.publishedAt}）` : ''}
          </p>
        ))}
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
  onAccept: (run: Run, startNext: boolean, warningReason?: string) => Promise<void>;
}) {
  const p = snapshot.project!,
    draft = snapshot.tagDraft,
    accepted = approvedCreation(p);
  const [input, setInput] = useState<TagInput>(draft ? cleanTagInput(draft) : emptyTagInput());
  const { busy: actionBusy, error, act } = useWorkspaceAction(refresh);
  const [note, setNote] = useState('');
  const [modelPending, setModelPending] = useState(false);
  const busy = actionBusy || modelPending;
  const [direction, setDirection] = useState(''),
    [resolutions, setResolutions] = useState<Record<string, string>>({});
  const [rework, setRework] = useState(''),
    [rerollInstruction, setRerollInstruction] = useState(''),
    [planFeedback, setPlanFeedback] = useState('');
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
    currentStep = (p.titlePending ? creationStep(run) : Math.min(2, creationStep(run))) as 1 | 2 | 3;
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
    setDirection(creationDirectionId(run));
    setResolutions({});
    setPlanFeedback('');
    setDiff(null);
  }, [run?.id, t?.reportHash]);
  useEffect(() => {
    setViewedStep(currentStep);
    if (run) {
      setInputOpen(false);
      flowRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [run?.id, currentStep]);
  const saved =
    !!draft &&
    (!run || runHasCurrentBasis(run, p)) &&
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
        proposalHash: run!.proposalHash!
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
      } else if (!p.titlePending) {
        await savePlan();
      }
    });
  const savePlan = async () => {
    // Confirmation and title selection change the proposal hash. Use the fresh candidate.
    const latest = await invoke('app.snapshot');
    const candidate = latest.runs.find(item => item.id === run!.id);
    if (!candidate) throw new Error('作品方案暂未取得，请刷新后重试');
    await onAccept(candidate, candidate.mode === 'stage' && continueAfterSave);
  };
  const reviewItems = (issues: PlanningReview['issues'] = []): CreationCheckItem[] =>
    issues.map((i) => ({
      text: showText(i.explanation),
      fix: showText(i.suggestedFix),
      kind: i.severity === 'minor' ? 'suggestion' : 'blocking'
    }));
  const validationIssues = creationValidationIssues(run);
  const validationItems: CreationCheckItem[] = validationIssues.map((i) => ({
    text: showText(i.message),
    kind: i.severity === 'error' ? 'blocking' : 'suggestion'
  }));
  const canAccept =
    t?.phase === 'ready' &&
    !busy &&
    !running &&
    saved &&
    !run?.issues.some((i) => i.severity === 'error') &&
    (t.workflowVersion !== 2 || (!!t.planApproval && (!p.titlePending || !!t.titleSelection)));
  const steps =
    t?.workflowVersion === 2 || !run
      ? p.titlePending ? ['选方向', '看方案', '选书名'] : ['选方向', '看方案并保存']
      : ['选方向', '确认方案'];
  const selectedDirection = report?.directions.find((d) => d.id === (t?.selectedDirectionId || direction));
  return (
    <section className="tag-workspace">
      <header className="creation-header">
        <div>
          <h1>{p.stage === 'S01' ? '准备你的新作品' : '调整作品方案'}</h1>
          <p className="muted">
            {accepted
              ? '查看修改后的方案，满意后保存为新的创作约定。'
              : p.stage === 'S01'
                ? '先选故事方向，再确定方案和书名。进度会自动保留。'
                : '查看已有设定的整理结果，满意后保存。'}
          </p>
        </div>
        <ModelControl profiles={snapshot.profiles} profileId={profileId} onProfileChange={setProfileId} disabled={actionBusy} onPendingChange={setModelPending} label="策划模型与推理强度" />
        <ContextMeter profile={snapshot.profiles.find(profile => profile.id === profileId)} usage={latestContext(snapshot.runs.filter(item => item.planning || item.naming))} />
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
                  <DirectionCards report={report} selectedId={t.selectedDirectionId || direction}
                    disabled={busy || running || t.phase !== 'awaiting_direction'} onSelect={setDirection} format={showText} />
                  <p className="creation-recommendation"><strong>推荐理由：</strong>{showText(report.recommendationReasons.join('；'))}</p>
                  {t.phase === 'awaiting_direction' && (
                    <div className="creation-reroll">
                      <label>
                        这次希望怎样构思（选填）
                        <textarea
                          rows={2}
                          maxLength={6000}
                          value={rerollInstruction}
                          disabled={busy || running}
                          onChange={(e) => setRerollInstruction(e.target.value)}
                          placeholder="例如：提高生存压力，让主角的能力必须付出代价"
                        />
                      </label>
                      <div className="creation-reroll-actions">
                        <button
                          disabled={busy || running || !saved}
                          onClick={() => void act(() => invoke('tags.reroll', {
                            id: run.id,
                            reportHash: t.reportHash!,
                            keepDirectionIds: [],
                            instruction: rerollInstruction
                          }))}
                        >换一批三案</button>
                        <button
                          disabled={busy || running || !saved || !direction}
                          onClick={() => void act(() => invoke('tags.reroll', {
                            id: run.id,
                            reportHash: t.reportHash!,
                            keepDirectionIds: [direction],
                            instruction: rerollInstruction
                          }))}
                        >保留这一案，换另两案</button>
                      </div>
                      <p className="muted">沿用当前创作要求，旧方案会保存在历史中。</p>
                    </div>
                  )}
                  {!!report.diagnosis.length && <details className="creation-background">
                    <summary>旧版构思记录</summary>
                    {report.diagnosis.map((v, i) => (
                      <p key={i}>{showText(v.message)}</p>
                    ))}
                  </details>}
                  {!!t.reportReview?.result.issues.length && <details className="advanced-box">
                    <summary>历史方向检查（仅供参考）</summary>
                    <CreationChecks title="旧版检查记录" items={reviewItems(t.reportReview.result.issues)} />
                  </details>}
                </>
              )}
              {t.phase === 'awaiting_direction' && selectedDirection && (
                <div className="tag-confirm">
                  <h3>为「{showText(selectedDirection.title)}」完善方案</h3>
                  {assumptions.length > 0 && (
                    <details className="direction-settings-editor">
                      <summary>调整模型新增设定（选填）</summary>
                      <p>上方已列出这个方向的新增设定。完善方案时会带入这些设定和你的修改意见。</p>
                      {assumptions.map((a) => (
                        <div className="creation-assumption" key={a.id}>
                          <p>{showText(a.text)}</p>
                          <label>
                            修改意见（选填）
                            <textarea
                              placeholder="不填则沿用上方设定，也可以直接说明不采用"
                              value={resolutions[a.id] ?? ''}
                              onChange={(e) => setResolutions({ ...resolutions, [a.id]: e.target.value })}
                            />
                          </label>
                        </div>
                      ))}
                    </details>
                  )}
                  <p className="muted">继续会按所选方向及上方列出的新增设定、创意调整完善方案；完整方案仍由你决定是否采用。</p>
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
                  <p className="muted">看看故事机制、人物目标和边界是否符合你的想法。不满意可以直接填写修改意见。</p>
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
                    <MarkdownContent
                      className="markdown-preview"
                      label="完整设定与约定"
                      content={showText(t.candidate.premiseDocument)}
                      onClick={(event) => handleMarkdownLink(event, url => { void act(() => invoke('app.openUrl', { url })); })}
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
              <CreationChecks title="方案检查" items={reviewItems(t.contractReview?.result.issues)} processing={run?.status === 'running'} />
              {t.phase === 'ready' && <CreationChecks title="内容建议" items={validationItems} />}
              {t.candidate && !run.accepted && ['ready', 'reviewing_contract'].includes(t.phase) && (
                <div className="content-feedback">
                  <label>想怎么改，直接告诉我
                    <textarea aria-label="作品方案修改意见" value={planFeedback} maxLength={6000} disabled={busy || running} onChange={event => setPlanFeedback(event.target.value)} placeholder="例如：保留回到过去的能力，把主角的目标改为寻找师父失踪的真相。" />
                  </label>
                  <button disabled={busy || running || !saved || !planFeedback.trim()} onClick={() => void act(async () => {
                    await invoke('creation.revisePlan', { id: run.id, proposalHash: run.proposalHash!, instruction: planFeedback.trim() });
                    setPlanFeedback('');
                  })}>按意见修改方案</button>
                </div>
              )}
              {t.phase === 'ready' && t.workflowVersion === 2 && (!t.planApproval || !p.titlePending) && (
                <div className="creation-next">
                  <div>
                    <span>
                      {p.titlePending && run.mode === 'stage'
                        ? '下一步：根据方案生成书名，供你选择'
                        : '满意后即可保存方案；书名可以以后再调整。'}
                    </span>
                    {p.titlePending && run.mode === 'stage' && (
                      <button
                        className="text-button"
                        disabled={
                          busy ||
                          running ||
                          !saved ||
                          run.issues.some((i) => i.severity === 'error')
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
                      run.issues.some((i) => i.severity === 'error')
                    }
                    onClick={() => void confirmPlan(!!p.titlePending && run.mode === 'stage')}
                  >
                    {p.titlePending && run.mode === 'stage' ? '满意，生成书名' : '满意，保存方案'}
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
                onSelected={savePlan}
                disabled={!saved || busy}
              />
              <CreationChecks title="内容建议" items={validationItems} />
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
                      ? '点击喜欢的书名下方“用这个书名并保存”，即可保存作品方案。'
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
              {(!p.titlePending || !!t.titleSelection || t.workflowVersion !== 2) && <button
                className="primary"
                disabled={!canAccept}
                onClick={() =>
                  void act(savePlan)
                }
              >
                {t.workflowVersion !== 2 && p.titlePending
                  ? '确认方案并确定书名'
                  : run.mode !== 'stage'
                    ? '满意，保存方案'
                    : continueAfterSave
                      ? '确认书名并继续'
                      : '确认书名并保存'}
              </button>}
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
