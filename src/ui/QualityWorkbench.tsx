import { ReviewObservations } from './ReviewObservations';
import { useEffect, useRef, useState } from 'react';
import { invokeCommand } from '../shared/client';
import type { CommandOutput } from '../shared/contracts';
import type { QualityState, QualityMutation, VoiceScope, WorldModel } from '../shared/quality';
import { useDialog } from './useDialog';
import './quality-workbench.css';
import { BranchWorkspace } from './BranchWorkspace';
import { ReadingExperience } from './ReadingExperience';
import { reviewFeedbackSchema } from '../shared/blind-review';

const empty: QualityState = {
  version: 1,
  revision: 0,
  protocols: [],
  reviewPackets: [],
  reviewImports: [],
  evidence: [],
  preferences: [],
  patterns: [],
  experiments: [],
  presentations: [],
  observations: []
};
const origins = { human_author: '作者', human_target_reader: '目标读者', model_simulation: '模型模拟' };
export function QualityWorkbench({ profileId, onRun }: { profileId: string; onRun: (id: string) => void }) {
  const [open, setOpen] = useState(false),
    [tab, setTab] = useState('voice'),
    [state, setState] = useState(empty);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const feedbackFile = useRef<HTMLInputElement>(null);
  const [documents, setDocuments] = useState<{ path: string; hash: string | null }[]>([]);
  const [path, setPath] = useState(''),
    [history, setHistory] = useState<{ hash: string; createdAt: string }[]>([]),
    [beforeHash, setBeforeHash] = useState('');
  const [beforeQuote, setBeforeQuote] = useState(''),
    [afterQuote, setAfterQuote] = useState(''),
    [reason, setReason] = useState('');
  const [domain, setDomain] = useState<
    'expression' | 'narrative_focus' | 'plot' | 'character' | 'fact_correction' | 'unknown'
  >('unknown');
  const [scope, setScope] = useState<VoiceScope>({ kind: 'scene', target: '', sceneFunction: '对话' });
  const [selected, setSelected] = useState<string[]>([]),
    [prompt, setPrompt] = useState('');
  const [world, setWorld] = useState<{ model: WorldModel; baseHash: string | null }>();
  const [custom, setCustom] = useState(''),
    [from, setFrom] = useState(1),
    [through, setThrough] = useState(1);
  const [title, setTitle] = useState(''),
    [left, setLeft] = useState(''),
    [right, setRight] = useState('');
  const [sampleRuns, setSampleRuns] = useState<{ id: string; title: string; draftId: string }[]>([]);
  const [leftRun, setLeftRun] = useState(''),
    [rightRun, setRightRun] = useState('');
  const [kind, setKind] = useState<'voice_fixed_story' | 'plot_bounded_changes' | 'workflow_continuation'>(
    'voice_fixed_story'
  );
  const [constraints, setConstraints] = useState(''),
    [participant, setParticipant] = useState('');
  const [protocolId, setProtocolId] = useState(''),
    [family, setFamily] = useState(''),
    [stage, setStage] = useState<'development' | 'holdout'>('development'),
    [maxCalls, setMaxCalls] = useState(10);
  const [experiment, setExperiment] = useState(''),
    [blind, setBlind] = useState<CommandOutput<'quality.presentation'>>();
  const [stats, setStats] = useState<CommandOutput<'quality.statistics'>>(),
    [origin, setOrigin] = useState<keyof typeof origins>('human_author');
  const [choice, setChoice] = useState('tie'),
    [feedback, setFeedback] = useState(''),
    [recruitment, setRecruitment] = useState('');
  const dialog = useRef<HTMLElement | null>(null);
  useDialog(dialog, open, () => setOpen(false));
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const mutate = async (mutation: QualityMutation) => {
    const next = await invokeCommand('quality.mutate', { expectedRevision: state.revision, mutation });
    setState(next);
    return next;
  };
  const started = (id: string) => {
    setOpen(false);
    onRun(id);
  };
  const specification = {
    title,
    kind,
    stage,
    family: family || title,
    sceneFunction: scope.sceneFunction,
    audience: '作者指定读者',
    variedFactors: [kind === 'voice_fixed_story' ? ('voice' as const) : ('plot' as const)],
    constraints,
    questions: ['更愿意继续阅读哪一份？为什么？']
  };
  useEffect(() => {
    if (open)
      void act(async () => {
        const [quality, resource, model] = await Promise.allSettled([
          invokeCommand('quality.read'),
          invokeCommand('resource.read', { resources: ['documents', 'runs'] }),
          invokeCommand('world.read')
        ]);
        if (quality.status === 'fulfilled') setState(quality.value);
        if (model.status === 'fulfilled') setWorld(model.value);
        if (resource.status === 'fulfilled') {
          setDocuments(resource.value.documents?.filter((d) => d.status === 'accepted') ?? []);
          setSampleRuns(
            (resource.value.runs ?? []).flatMap((r) =>
              r.status === 'complete' && r.creative?.result?.draftId
                ? [{ id: r.id, title: r.request.slice(0, 60), draftId: r.creative.result.draftId }]
                : []
            )
          );
        }
        const failed = [quality, resource, model].filter((value) => value.status === 'rejected');
        if (failed.length)
          setError(
            failed
              .map((value) => (value.reason instanceof Error ? value.reason.message : String(value.reason)))
              .join('；')
          );
      });
  }, [open]);
  useEffect(() => {
    if (path)
      void act(async () => {
        const versions = await invokeCommand('document.history', { path });
        setHistory(versions);
        setBeforeHash(
          versions.find((v) => v.hash !== documents.find((d) => d.path === path)?.hash)?.hash ?? ''
        );
      });
  }, [path]);
  const scopeFields = (
    <div className="quality-grid">
      <label>
        适用范围
        <select
          value={scope.kind}
          onChange={(e) => setScope({ ...scope, kind: e.target.value as VoiceScope['kind'], target: '' })}
        >
          <option value="scene">当前场景</option>
          <option value="character">指定人物</option>
          <option value="book">本书叙述</option>
        </select>
      </label>
      {scope.kind !== 'book' && (
        <label>
          {scope.kind === 'character' ? '人物标识' : '场景名称'}
          <input value={scope.target} onChange={(e) => setScope({ ...scope, target: e.target.value })} />
        </label>
      )}
      <label>
        场景功能
        <input
          value={scope.sceneFunction}
          onChange={(e) => setScope({ ...scope, sceneFunction: e.target.value })}
        />
      </label>
    </div>
  );
  return (
    <>
      <button onClick={() => setOpen(true)}>创作工作台</button>
      {open && (
        <div className="scrim">
          <section
            ref={dialog}
            className="modal quality-workbench"
            role="dialog"
            aria-modal="true"
            aria-label="创作工作台"
          >
            <header>
              <h2>创作工作台</h2>
              <button aria-label="关闭创作工作台" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>
            <nav className="quality-tabs" aria-label="工作台视图">
              {[
                ['voice', '声音'],
                ['evidence', '编辑记录'],
                ['compare', '对比试读'],
                ['patterns', '剧情解法'],
                ['world', '世界模块'],
                ['branches', '分支'],
                ['reading', '阅读轨迹']
              ].map(([id, label]) => (
                <button
                  key={id}
                  aria-pressed={tab === id}
                  className={tab === id ? 'active' : ''}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </nav>
            <div className="modal-body quality-body">
              <fieldset disabled={busy}>
                {tab === 'branches' && <BranchWorkspace onRun={started} />}
                {tab === 'reading' && <ReadingExperience />}
                {error && (
                  <p role="alert" className="error">
                    {error}
                  </p>
                )}
                {tab === 'evidence' && (
                  <>
                    <form
                      className="form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act(async () => {
                          const before = await invokeCommand('document.read', { path, hash: beforeHash }),
                            after = await invokeCommand('document.read', { path });
                          const span = (doc: typeof before, quote: string) => {
                            const offset = doc.content.indexOf(quote);
                            if (!quote || offset < 0 || doc.content.indexOf(quote, offset + 1) >= 0)
                              throw new Error('请选择能够唯一定位的连续原文');
                            const start = Array.from(doc.content.slice(0, offset)).length;
                            return {
                              path,
                              hash: doc.hash,
                              start,
                              end: start + Array.from(quote).length,
                              quote
                            };
                          };
                          await mutate({
                            kind: 'evidence',
                            evidence: {
                              before: span(before, beforeQuote),
                              after: span(after, afterQuote),
                              scope,
                              domain,
                              reason,
                              editor: 'author'
                            }
                          });
                          setBeforeQuote('');
                          setAfterQuote('');
                          setReason('');
                        });
                      }}
                    >
                      <div className="quality-grid">
                        <label>
                          文稿
                          <select required value={path} onChange={(e) => setPath(e.target.value)}>
                            <option value="">选择文稿</option>
                            {documents
                              .filter((d) => d.path.startsWith('07_'))
                              .map((d) => (
                                <option key={d.path} value={d.path}>
                                  {d.path.split('/').at(-1)}
                                </option>
                              ))}
                          </select>
                        </label>
                        <label>
                          修改前版本
                          <select required value={beforeHash} onChange={(e) => setBeforeHash(e.target.value)}>
                            <option value="">选择版本</option>
                            {history
                              .filter((h) => h.hash !== documents.find((d) => d.path === path)?.hash)
                              .map((h) => (
                                <option key={h.hash} value={h.hash}>
                                  {h.createdAt}
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                      <div className="quality-grid">
                        <label>
                          修改前原句
                          <textarea
                            required
                            value={beforeQuote}
                            onChange={(e) => setBeforeQuote(e.target.value)}
                          />
                        </label>
                        <label>
                          修改后原句
                          <textarea
                            required
                            value={afterQuote}
                            onChange={(e) => setAfterQuote(e.target.value)}
                          />
                        </label>
                      </div>
                      {scopeFields}
                      <label>
                        修改类型
                        <select value={domain} onChange={(e) => setDomain(e.target.value as typeof domain)}>
                          {[
                            ['unknown', '原因未知'],
                            ['expression', '表达'],
                            ['narrative_focus', '叙述重点'],
                            ['fact_correction', '纠错'],
                            ['plot', '剧情'],
                            ['character', '人物']
                          ].map(([id, title]) => (
                            <option key={id} value={id}>
                              {title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        修改原因
                        <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
                      </label>
                      <button type="submit">保存记录</button>
                    </form>
                    <div className="quality-cards">
                      {state.evidence.map((e) => (
                        <article key={e.id}>
                          <strong>
                            {e.scope.target || '本书叙述'} · {e.scope.sceneFunction}
                          </strong>
                          <div className="quality-grid">
                            <del>{e.before.quote}</del>
                            <span>{e.after.quote}</span>
                          </div>
                          <p>{e.reason || '原因未知'}</p>
                          <button
                            disabled={e.state === 'retracted'}
                            onClick={() => void act(() => mutate({ kind: 'retract', id: e.id }))}
                          >
                            {e.state === 'retracted' ? '已撤回' : '撤回'}
                          </button>
                        </article>
                      ))}
                    </div>
                  </>
                )}
                {tab === 'voice' && (
                  <>
                    <div className="quality-actions">
                      <button
                        disabled={!state.evidence.some((e) => e.state === 'active' && e.usable !== false)}
                        onClick={() =>
                          void act(async () =>
                            started(
                              await invokeCommand('creative.run', {
                                profileId,
                                input: {
                                  operation: 'learn-edits',
                                  evidenceIds: state.evidence
                                    .filter((e) => e.state === 'active' && e.usable !== false)
                                    .slice(-50)
                                    .map((e) => e.id)
                                }
                              })
                            )
                          )
                        }
                      >
                        学习编辑偏好
                      </button>
                      <button
                        disabled={!selected.length}
                        onClick={() =>
                          void act(async () =>
                            started(await invokeCommand('quality.voice', { ids: selected }))
                          )
                        }
                      >
                        应用所选偏好
                      </button>
                    </div>
                    <div className="quality-cards">
                      {state.preferences.map((p) => (
                        <article key={p.id}>
                          <label className="quality-select">
                            <input
                              type="checkbox"
                              disabled={p.state !== 'proposal'}
                              checked={selected.includes(p.id)}
                              onChange={(e) =>
                                setSelected(
                                  e.target.checked
                                    ? [...selected, p.id]
                                    : selected.filter((id) => id !== p.id)
                                )
                              }
                            />
                            <strong>{p.statement}</strong>
                            <span>
                              {
                                { proposal: '待采纳', insufficient_evidence: '依据不足', stale: '待复核' }[
                                  p.state
                                ]
                              }
                            </span>
                          </label>
                          <p>
                            {p.scope.target || '本书叙述'} · {p.scope.sceneFunction}
                          </p>
                          {p.exceptions.length > 0 && <p>{p.exceptions.join('；')}</p>}
                        </article>
                      ))}
                    </div>
                    <form
                      className="form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void act(async () =>
                          started(
                            await invokeCommand('creative.run', {
                              profileId,
                              input: {
                                operation: 'voice-pilot',
                                prompt,
                                scope,
                                sources: path ? [path] : [],
                                ...(protocolId ? { protocolId } : {})
                              }
                            })
                          )
                        );
                      }}
                    >
                      {scopeFields}
                      {state.protocols.length > 0 && (
                        <label>
                          实验方案
                          <select value={protocolId} onChange={(e) => setProtocolId(e.target.value)}>
                            <option value="">独立试写</option>
                            {state.protocols.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.title}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                      <label>
                        试写场景
                        <textarea required value={prompt} onChange={(e) => setPrompt(e.target.value)} />
                      </label>
                      <button type="submit">生成试写</button>
                    </form>
                  </>
                )}
                {tab === 'patterns' && (
                  <>
                    <div className="quality-grid">
                      <label>
                        起始章
                        <input
                          type="number"
                          min={1}
                          value={from}
                          onChange={(e) => setFrom(Number(e.target.value))}
                        />
                      </label>
                      <label>
                        结束章
                        <input
                          type="number"
                          min={from}
                          max={from + 11}
                          value={through}
                          onChange={(e) => setThrough(Number(e.target.value))}
                        />
                      </label>
                    </div>
                    <button
                      disabled={through < from || through - from > 11}
                      onClick={() =>
                        void act(async () =>
                          started(
                            await invokeCommand('creative.run', {
                              profileId,
                              input: {
                                operation: 'patterns',
                                chapters: Array.from({ length: through - from + 1 }, (_, i) => from + i),
                                request: ''
                              }
                            })
                          )
                        )
                      }
                    >
                      比较解法
                    </button>
                    <div className="quality-cards">
                      {state.patterns.map((p) => (
                        <article key={p.id}>
                          <h3>
                            第 {p.chapter} 章 · {p.scene}
                            {p.state === 'stale' ? ' · 待重建' : ''}
                          </h3>
                          <dl>
                            {[
                              ['冲突', p.conflict],
                              ['策略', p.strategy],
                              ['回应', p.response],
                              ['解法', p.solution],
                              ['变化', p.change],
                              ['回报', p.reward]
                            ].map(([label, value]) => (
                              <div key={label}>
                                <dt>{label}</dt>
                                <dd>{value}</dd>
                              </div>
                            ))}
                          </dl>
                          <label>
                            重复用途
                            <select
                              value={p.protectedRepetition}
                              onChange={(e) =>
                                void act(() =>
                                  mutate({
                                    kind: 'protect-pattern',
                                    id: p.id,
                                    reason: e.target.value as typeof p.protectedRepetition
                                  })
                                )
                              }
                            >
                              <option value="none">未指定</option>
                              <option value="echo">有意回响</option>
                              <option value="ability_reuse">能力复用</option>
                              <option value="payoff">承诺兑现</option>
                            </select>
                          </label>
                        </article>
                      ))}
                    </div>
                  </>
                )}
                {tab === 'world' && world && (
                  <>
                    <div className="quality-cards quality-world">
                      {world.model.modules.map((m, i) => (
                        <article key={m.id}>
                          <div className="quality-grid">
                            <h3>{m.title}</h3>
                            <select
                              aria-label={`${m.title}状态`}
                              value={m.state}
                              onChange={(e) =>
                                setWorld({
                                  ...world,
                                  model: {
                                    ...world.model,
                                    modules: world.model.modules.map((v, n) =>
                                      n === i ? { ...v, state: e.target.value as typeof m.state } : v
                                    )
                                  }
                                })
                              }
                            >
                              <option value="undecided">暂未确定</option>
                              <option value="enabled">启用</option>
                              <option value="disabled">停用</option>
                            </select>
                          </div>
                          {m.state === 'enabled' && (
                            <>
                              <textarea
                                aria-label={`${m.title}设定`}
                                value={m.content}
                                onChange={(e) =>
                                  setWorld({
                                    ...world,
                                    model: {
                                      ...world.model,
                                      modules: world.model.modules.map((v, n) =>
                                        n === i ? { ...v, content: e.target.value } : v
                                      )
                                    }
                                  })
                                }
                              />
                              <label className="quality-select">
                                <input
                                  type="checkbox"
                                  checked={m.locked}
                                  onChange={(e) =>
                                    setWorld({
                                      ...world,
                                      model: {
                                        ...world.model,
                                        modules: world.model.modules.map((v, n) =>
                                          n === i ? { ...v, locked: e.target.checked } : v
                                        )
                                      }
                                    })
                                  }
                                />
                                固定此设定
                              </label>
                            </>
                          )}
                        </article>
                      ))}
                    </div>
                    <div className="quality-actions">
                      <input
                        aria-label="自定义模块名称"
                        placeholder="自定义模块名称"
                        value={custom}
                        onChange={(e) => setCustom(e.target.value)}
                      />
                      <button
                        disabled={!custom.trim()}
                        onClick={() => {
                          setWorld({
                            ...world,
                            model: {
                              ...world.model,
                              modules: [
                                ...world.model.modules,
                                {
                                  id: `custom:${crypto.randomUUID()}`,
                                  title: custom.trim(),
                                  state: 'enabled',
                                  content: '',
                                  origin: 'author',
                                  locked: false
                                }
                              ]
                            }
                          });
                          setCustom('');
                        }}
                      >
                        添加模块
                      </button>
                      <button
                        onClick={() =>
                          void act(async () => started(await invokeCommand('world.propose', world)))
                        }
                      >
                        保存为候选
                      </button>
                    </div>
                    {world.model.original && (
                      <details>
                        <summary>原有设定</summary>
                        <pre>{world.model.original}</pre>
                      </details>
                    )}
                  </>
                )}
                {tab === 'compare' && (
                  <>
                    <div className="quality-actions">
                      <button
                        disabled={!state.experiments.length || state.experiments.length > 100}
                        onClick={() =>
                          void act(async () => {
                            const result = await invokeCommand('quality.exportReview', {
                              experimentIds: state.experiments.map((e) => e.id)
                            });
                            const url = URL.createObjectURL(
                              new Blob([result.html], { type: 'text/html;charset=utf-8' })
                            );
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = '星月书台-匿名试读.html';
                            link.click();
                            setTimeout(() => URL.revokeObjectURL(url), 1000);
                            setState(await invokeCommand('quality.read'));
                            setNotice('试读文件已导出');
                          })
                        }
                      >
                        导出全部试读
                      </button>
                      <button onClick={() => feedbackFile.current?.click()}>导入读者反馈</button>
                      <input
                        ref={feedbackFile}
                        type="file"
                        accept=".json,application/json"
                        aria-label="读者反馈文件"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = '';
                          if (file)
                            void act(async () => {
                              if (file.size > 2 * 1024 * 1024) throw new Error('反馈文件过大，请分开导入');
                              let content: unknown;
                              try {
                                content = JSON.parse(await file.text());
                              } catch {
                                throw new Error('无法读取反馈文件，请选择试读页导出的文件');
                              }
                              const parsed = reviewFeedbackSchema.safeParse(content);
                              if (!parsed.success) throw new Error('反馈内容不完整，请重新从试读页导出');
                              const result = await invokeCommand('quality.importReview', {
                                expectedRevision: state.revision,
                                feedback: parsed.data
                              });
                              setState(result.state);
                              if (experiment)
                                setStats(
                                  await invokeCommand('quality.statistics', { experimentId: experiment })
                                );
                              setNotice(
                                result.duplicate ? '这份反馈已经导入' : `已导入 ${result.imported} 条反馈`
                              );
                            });
                        }}
                      />
                    </div>
                    {notice && <p role="status">{notice}</p>}
                    <details>
                      <summary>新建对比试读</summary>
                      <form
                        className="form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act(async () => {
                            const next = await mutate({
                              kind: 'experiment',
                              experiment: { ...specification, ...(protocolId ? { protocolId } : {}) },
                              candidates: [
                                { text: left, runId: leftRun },
                                { text: right, runId: rightRun }
                              ]
                            });
                            setExperiment(next.experiments.at(-1)!.id);
                          });
                        }}
                      >
                        <label>
                          试读名称
                          <input required value={title} onChange={(e) => setTitle(e.target.value)} />
                        </label>
                        <div className="quality-grid">
                          <label>
                            创意族
                            <input value={family} onChange={(e) => setFamily(e.target.value)} />
                          </label>
                          <label>
                            样本用途
                            <select value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>
                              <option value="development">开发集</option>
                              <option value="holdout">保留集</option>
                            </select>
                          </label>
                          <label>
                            场景功能
                            <input
                              value={scope.sceneFunction}
                              onChange={(e) => setScope({ ...scope, sceneFunction: e.target.value })}
                            />
                          </label>
                        </div>
                        <label>
                          比较内容
                          <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
                            <option value="voice_fixed_story">相同剧情的表达</option>
                            <option value="plot_bounded_changes">指定范围的剧情变化</option>
                            <option value="workflow_continuation">连续创作</option>
                          </select>
                        </label>
                        <label>
                          必须保持的内容
                          <textarea
                            required
                            value={constraints}
                            onChange={(e) => setConstraints(e.target.value)}
                          />
                        </label>
                        <div className="quality-grid">
                          <label>
                            样稿一来源
                            <select
                              value={leftRun}
                              onChange={(e) =>
                                void act(async () => {
                                  const r = sampleRuns.find((r) => r.id === e.target.value);
                                  setLeftRun(e.target.value);
                                  if (r)
                                    setLeft((await invokeCommand('draft.read', { id: r.draftId })).content);
                                })
                              }
                            >
                              <option value="">自行提供</option>
                              {sampleRuns.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.title}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label>
                            样稿二来源
                            <select
                              value={rightRun}
                              onChange={(e) =>
                                void act(async () => {
                                  const r = sampleRuns.find((r) => r.id === e.target.value);
                                  setRightRun(e.target.value);
                                  if (r)
                                    setRight((await invokeCommand('draft.read', { id: r.draftId })).content);
                                })
                              }
                            >
                              <option value="">自行提供</option>
                              {sampleRuns.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.title}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                        <div className="quality-grid">
                          <label>
                            样稿一
                            <textarea
                              required
                              value={left}
                              onChange={(e) => {
                                setLeft(e.target.value);
                                setLeftRun('');
                              }}
                            />
                          </label>
                          <label>
                            样稿二
                            <textarea
                              required
                              value={right}
                              onChange={(e) => {
                                setRight(e.target.value);
                                setRightRun('');
                              }}
                            />
                          </label>
                        </div>
                        <details>
                          <summary>实验预登记</summary>
                          <label>
                            调用上限
                            <input
                              type="number"
                              min={1}
                              max={10000}
                              value={maxCalls}
                              onChange={(e) => setMaxCalls(Number(e.target.value))}
                            />
                          </label>
                          <button
                            type="button"
                            disabled={!title.trim() || !constraints.trim()}
                            onClick={() =>
                              void act(async () => {
                                const next = await mutate({
                                  kind: 'protocol',
                                  protocol: {
                                    ...specification,
                                    maxCalls,
                                    comparisonRule:
                                      '按参与者和创意族分组；作者、目标读者、模型模拟分别统计。',
                                    exclusionRule:
                                      '保留平局、弃权、都不满意与排除原因；同一次展示只计一次有效反馈。'
                                  }
                                });
                                setProtocolId(next.protocols.at(-1)!.id);
                              })
                            }
                          >
                            登记实验条件
                          </button>
                          <label>
                            使用预登记
                            <select
                              value={protocolId}
                              onChange={(e) => {
                                setProtocolId(e.target.value);
                                const p = state.protocols.find((p) => p.id === e.target.value);
                                if (p) {
                                  setTitle(p.title);
                                  setKind(p.kind);
                                  setFamily(p.family);
                                  setStage(p.stage);
                                  setConstraints(p.constraints);
                                  setScope({ ...scope, sceneFunction: p.sceneFunction });
                                  setMaxCalls(p.maxCalls);
                                }
                              }}
                            >
                              <option value="">未预登记</option>
                              {state.protocols.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.title} · {p.stage === 'holdout' ? '保留集' : '开发集'}
                                </option>
                              ))}
                            </select>
                          </label>
                        </details>
                        <button type="submit">创建试读</button>
                      </form>
                    </details>
                    <div className="quality-grid">
                      <label>
                        试读
                        <select
                          value={experiment}
                          onChange={(e) => {
                            setExperiment(e.target.value);
                            setBlind(undefined);
                            setStats(undefined);
                          }}
                        >
                          <option value="">选择试读</option>
                          {state.experiments.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        读者代号
                        <input value={participant} onChange={(e) => setParticipant(e.target.value)} />
                      </label>
                    </div>
                    <div className="quality-actions">
                      <button
                        disabled={!experiment || !participant}
                        onClick={() =>
                          void act(async () => {
                            const next = await mutate({
                              kind: 'present',
                              experimentId: experiment,
                              participant
                            });
                            const p = next.presentations.find(
                              (p) => p.experimentId === experiment && p.participant === participant
                            )!;
                            setBlind(await invokeCommand('quality.presentation', { id: p.id }));
                          })
                        }
                      >
                        开始匿名试读
                      </button>
                      <button
                        disabled={!experiment}
                        onClick={() =>
                          void act(async () =>
                            setStats(await invokeCommand('quality.statistics', { experimentId: experiment }))
                          )
                        }
                      >
                        查看统计
                      </button>
                      <button
                        disabled={!experiment}
                        onClick={() =>
                          void act(async () =>
                            started(
                              await invokeCommand('creative.run', {
                                profileId,
                                input: { operation: 'compare-feedback', experimentId: experiment }
                              })
                            )
                          )
                        }
                      >
                        分析反馈
                      </button>
                    </div>
                    {blind && (
                      <>
                        <div className="quality-grid">
                          {blind.candidates.map((c) => (
                            <article key={c.alias}>
                              <h3>样稿 {c.alias}</h3>
                              <div className="quality-prose">{c.text}</div>
                            </article>
                          ))}
                        </div>
                        <form
                          className="form"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void act(async () => {
                              await mutate({
                                kind: 'feedback',
                                observation: {
                                  presentationId: blind.id,
                                  origin,
                                  outcome: /^[A-F]$/.test(choice)
                                    ? 'preferred'
                                    : (choice as 'tie' | 'both_unsatisfactory' | 'abstained'),
                                  alias: /^[A-F]$/.test(choice) ? choice : '',
                                  reason: feedback,
                                  nextQuestion: '',
                                  reading: '',
                                  annotations: [],
                                  recruitment,
                                  excluded: ''
                                }
                              });
                              setBlind(undefined);
                              setStats(
                                await invokeCommand('quality.statistics', { experimentId: experiment })
                              );
                            });
                          }}
                        >
                          <div className="quality-grid">
                            <label>
                              反馈来源
                              <select
                                value={origin}
                                onChange={(e) => setOrigin(e.target.value as typeof origin)}
                              >
                                {Object.entries(origins).map(([id, title]) => (
                                  <option key={id} value={id}>
                                    {title}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label>
                              选择
                              <select value={choice} onChange={(e) => setChoice(e.target.value)}>
                                {blind.candidates.map((c) => (
                                  <option key={c.alias} value={c.alias}>
                                    样稿 {c.alias}
                                  </option>
                                ))}
                                <option value="tie">平局</option>
                                <option value="both_unsatisfactory">都不满意</option>
                                <option value="abstained">弃权</option>
                              </select>
                            </label>
                          </div>
                          {origin === 'human_target_reader' && (
                            <label>
                              读者来源
                              <input
                                required
                                value={recruitment}
                                onChange={(e) => setRecruitment(e.target.value)}
                              />
                            </label>
                          )}
                          <label>
                            原因
                            <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} />
                          </label>
                          <button type="submit">提交反馈</button>
                        </form>
                      </>
                    )}
                    {stats && (
                      <div className="quality-cards">
                        {stats.strata.map((s) => (
                          <article key={s.origin}>
                            <h3>{origins[s.origin]}</h3>
                            <p>
                              {s.participants} 位参与者 · {s.comparisons} 次比较 · {s.ties} 次平局 ·{' '}
                              {s.unsatisfactory} 次都不满意 · {s.abstentions} 次弃权
                            </p>
                            <div className="quality-grid">
                              {state.experiments
                                .find((e) => e.id === experiment)
                                ?.candidates.map((candidate, index) => (
                                  <span key={candidate.id}>
                                    样稿 {index + 1} · {s.wins[candidate.id] ?? 0} 票
                                  </span>
                                ))}
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                    {stats && (
                      <ReviewObservations
                        state={state}
                        experimentId={experiment}
                        excludedCount={stats.excluded.length}
                        onWithdraw={(id) =>
                          void act(async () => {
                            await mutate({ kind: 'withdraw', id });
                            setStats(await invokeCommand('quality.statistics', { experimentId: experiment }));
                          })
                        }
                      />
                    )}
                  </>
                )}
              </fieldset>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
