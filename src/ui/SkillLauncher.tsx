import { invokeCommand } from '../shared/client';
import { useEffect, useRef, useState } from 'react';
import { useDialog } from './useDialog';
import { creativeOperations, type CreativeInput } from '../shared/creative';
import type { CommandOutput } from '../shared/contracts';
function resultText(value: any): string {
  if (Array.isArray(value)) return value.map((v) => String(v).split('/').at(-1)).join('\n') || '检查完成';
  const issues = value.issues?.map((v: any) => (typeof v === 'string' ? v : v.message)).filter(Boolean) ?? [];
  if (issues.length) return issues.join('\n');
  if (value.sources)
    return `已整理 ${value.sources.length} 份资料 · ${value.retrievedFacts?.length ?? 0} 条记忆`;
  if (value.documents)
    return `检查完成 · ${value.documents.length} 份文稿${value.facts ? ` · ${value.facts.length} 条记忆` : ''}`;
  if (value.batch)
    return `第 ${value.batch.start}—${value.batch.end} 章 · ${value.complete ? '已完成' : '进行中'}`;
  return '检查完成';
}
export function SkillLauncher({ profileId, onRun }: { profileId: string; onRun: (id?: string) => void }) {
  const [open, setOpen] = useState(false),
    [skills, setSkills] = useState<{ id: string; title: string; host: boolean }[]>([]),
    [selected, setSelected] = useState('webnovel-continuity-audit'),
    [request, setRequest] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState('');
  const [feedback, setFeedback] = useState({ source: '', window: '', sampleSize: 0, synthetic: false });
  const [designs, setDesigns] = useState<CommandOutput<'design.list'>>([]);
  const [protocols, setProtocols] = useState<CommandOutput<'quality.read'>['protocols']>([]), [protocolId, setProtocolId] = useState('');
  const [targets, setTargets] = useState<string[]>([]), [sourceRun, setSourceRun] = useState(''), [direction, setDirection] = useState('');
  const [targetKind, setTargetKind] = useState<'book_title' | 'entity_name' | 'blurb'>('book_title');
  const [runs, setRuns] = useState<NonNullable<CommandOutput<'resource.read'>['runs']>>([]);
  const design = selected.startsWith('design:') ? designs.find(d => d.id === selected.slice(7)) : undefined;
  const [chapter, setChapter] = useState(1), [character, setCharacter] = useState('');
  const [characters, setCharacters] = useState<{ id: string; name: string }[]>([]);
  const [displayedTitle, setDisplayedTitle] = useState(''), [displayedDescription, setDisplayedDescription] = useState('');
  const [end, setEnd] = useState('');
  const [sources, setSources] = useState<string[]>([]), [documents, setDocuments] = useState<{ path: string }[]>([]);
  const [preferences, setPreferences] = useState(''), [exploration, setExploration] = useState('');
  const [parentRunId, setParentRunId] = useState(''), [parents, setParents] = useState<{ id: string; request: string; createdAt: string }[]>([]);
  const creative = selected.startsWith('creative:') ? selected.slice('creative:'.length) : undefined;
  useEffect(() => {
    if (open) void invokeCommand('quality.read').then(value => setProtocols(value.protocols)).catch(e => setError(e.message));
    if (open) void invokeCommand('resource.read', { resources: ['documents', 'runs'] }).then(data => { setRuns(data.runs ?? []); setDocuments(data.documents?.filter(d => d.status === 'accepted') ?? []); setParents(data.runs?.filter(r => r.status === 'complete' && r.creative?.result?.turn) ?? []); }).catch(e => setError(e.message));
  }, [open]);
  useEffect(() => {
    void invokeCommand('design.list').then(setDesigns).catch(e => setError(e.message));
    if (!open || creative !== 'rehearse' || !Number.isInteger(chapter) || chapter < 1) return;
    let current = true;
    void invokeCommand('creative.characters', { chapter }).then(values => {
      if (!current) return;
      setCharacters(values);
      setCharacter(previous => values.some(value => value.id === previous) ? previous : values[0]?.id ?? '');
    }).catch(error => { if (current) setError(error.message); });
    return () => { current = false; };
  }, [open, creative, chapter]);
  const dialog = useRef<HTMLElement | null>(null);
  useDialog(dialog, open, () => setOpen(false));
  useEffect(() => {
    void invokeCommand('skills.list')
      .then(setSkills)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <button onClick={() => setOpen(true)}>创作工具</button>
      {open && (
        <div className="scrim">
          <section ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label="创作工具">
            <header>
              <h2>创作工具</h2>
              <button aria-label="关闭创作工具" onClick={() => setOpen(false)}>
                ×
              </button>
            </header>
            <form
              className="modal-body form"
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                setError('');
                const input: CreativeInput | undefined = creative === 'first-read'
                  ? { operation: 'first-read', throughChapter: chapter, ...(end ? { end: Number(end) } : {}), displayedTitle, displayedDescription }
                  : creative === 'rehearse' ? { operation: 'rehearse', characterId: character, chapter, observations: request, ...(parentRunId ? { parentRunId } : {}) }
                  : creative === 'explore' ? { operation: 'explore', prompt: request, sources, ...(protocolId ? { protocolId } : {}), ...(preferences ? { preferences } : {}), ...(exploration ? { exploration } : {}) } : undefined;
                const task = design ? invokeCommand('design.run', { profileId, input: { id: design.id, request, sources, targets, chapter, ...(sourceRun ? { runId: sourceRun } : {}), ...(direction ? { directionId: direction } : {}), ...(design.targetKind ? { targetKind } : {}), ...(design.feedback ? { feedback } : {}) } }) : input ? invokeCommand('creative.run', { input, profileId }) : invokeCommand('skill.run', {
                    skillId: selected,
                    request: request || skills.find((s) => s.id === selected)?.title,
                    profileId,
                    ...(selected === 'webnovel-reader-feedback' ? { feedback } : {})
                  });
                void task.then((r) => {
                    if (typeof r === 'string') {
                      onRun(r);
                      setOpen(false);
                    } else setResult(resultText(r));
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                工具
                <select
                  value={selected}
                  onChange={(e) => {
                    setSelected(e.target.value);
                    setResult('');
                    setError('');
                  }}
                >
                  {[...new Set(designs.map(d => d.group))].map(group => <optgroup key={group} label={group}>{designs.filter(d => d.group === group).map(d => <option key={d.id} value={`design:${d.id}`}>{d.title}</option>)}</optgroup>)}
                  <optgroup label="原有工具">{skills.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}</optgroup>
                  {creativeOperations.filter(operation => ['first-read', 'rehearse', 'explore'].includes(operation.id)).map(operation => <option key={operation.id} value={`creative:${operation.id}`}>{operation.title}</option>)}
                </select>
              </label>
              {creative !== 'first-read' && <label>
                {creative === 'rehearse' ? '角色在当前场景可观察到的言行' : '任务'}
                <textarea
                  aria-label="工具任务"
                  required={!!creative}
                  value={request}
                  onChange={(e) => setRequest(e.target.value)}
                  placeholder="目标与范围"
                />
              </label>}
              {design && <>
                {design.targetSelection && <label>允许修改的文稿<select required multiple value={targets} onChange={e => setTargets(Array.from(e.target.selectedOptions).map(o => o.value))}>{documents.filter(d => design.id !== 'revision.voice' || d.path.startsWith('07_')).map(d => <option key={d.path} value={d.path}>{d.path.split('/').at(-1)}</option>)}</select></label>}
                {design.targetKind && <label>核验对象<select value={targetKind} onChange={e => setTargetKind(e.target.value as typeof targetKind)}><option value="book_title">书名</option><option value="entity_name">人物与实体名称</option><option value="blurb">简介</option></select></label>}
                <details><summary>资料与范围</summary><label>参考资料<select multiple value={sources} onChange={e => setSources(Array.from(e.target.selectedOptions).map(o => o.value))}>{documents.map(d => <option key={d.path} value={d.path}>{d.path.split('/').at(-1)}</option>)}</select></label><label>章节<input type="number" min={1} value={chapter} onChange={e => setChapter(Number(e.target.value))} /></label></details>
                {design.adapter !== 'scoped-task' && <label>来源任务<select value={sourceRun} onChange={e => { setSourceRun(e.target.value); setDirection(''); }}><option value="">当前作品</option>{runs.filter(r => design.adapter === 'revision-core' ? r.changes.some(c => c.path.startsWith('07_')) : !!r.planning).map(r => <option key={r.id} value={r.id}>{r.request} · {r.createdAt}</option>)}</select></label>}
                {design.adapter === 'planning' && design.id !== 'concept-forge.create' && <label>{design.id === 'concept-forge.regenerate' ? '保留方向' : '故事方向'}<select value={direction} onChange={e => setDirection(e.target.value)}><option value="">选择方向</option>{runs.find(r => r.id === sourceRun)?.planning?.report?.directions.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}</select></label>}
              </>}
              {(creative === 'first-read' || creative === 'rehearse') && <div className={creative === 'first-read' ? 'form-grid' : undefined}><label>
                {creative === 'first-read' ? '阅读截至第几章' : '故事位置：第几章'}
                <input type="number" min={1} max={100000} required value={chapter} onChange={event => setChapter(Number(event.target.value))} />
              </label>{creative === 'first-read' && <label>本章截止字符数（可留空）<input type="number" min={1} value={end} onChange={event => setEnd(event.target.value)} /></label>}</div>}
              {creative === 'first-read' && <>
                <label>展示给读者的书名（可留空）<input value={displayedTitle} maxLength={200} onChange={event => setDisplayedTitle(event.target.value)} /></label>
                <label>展示给读者的简介（可留空）<textarea value={displayedDescription} maxLength={5000} onChange={event => setDisplayedDescription(event.target.value)} /></label>
              </>}
              {creative === 'rehearse' && <>
                <label>上一回合<select value={parentRunId} onChange={e => setParentRunId(e.target.value)}><option value="">重新开始</option>{parents.map(parent => <option key={parent.id} value={parent.id}>{parent.request} · {parent.createdAt}</option>)}</select></label>
                <label>试演人物<select required value={character} onChange={event => setCharacter(event.target.value)}>
                  <option value="">{characters.length ? '选择人物' : '此章尚无可用的角色知情记录'}</option>
                  {characters.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
                </select></label>
              </>}
              {creative === 'explore' && <details><summary>资料与创作范围</summary><label>实验方案<select value={protocolId} onChange={e => setProtocolId(e.target.value)}><option value="">独立创作</option>{protocols.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></label><label>参考资料<select multiple value={sources} onChange={e => setSources(Array.from(e.target.selectedOptions).map(o => o.value))}>{documents.map(d => <option key={d.path} value={d.path}>{d.path.split('/').at(-1)}</option>)}</select></label><label>当前偏好<textarea value={preferences} onChange={e => setPreferences(e.target.value)} /></label><label>允许探索<textarea value={exploration} onChange={e => setExploration(e.target.value)} /></label></details>}
              {(selected === 'webnovel-reader-feedback' || design?.feedback) && (
                <>
                  <label>
                    反馈来源
                    <input
                      required
                      value={feedback.source}
                      onChange={(e) => setFeedback({ ...feedback, source: e.target.value })}
                    />
                  </label>
                  <label>
                    采集时间
                    <input
                      required
                      value={feedback.window}
                      onChange={(e) => setFeedback({ ...feedback, window: e.target.value })}
                    />
                  </label>
                  <label>
                    样本量
                    <input
                      type="number"
                      min={0}
                      value={feedback.sampleSize}
                      onChange={(e) => setFeedback({ ...feedback, sampleSize: Number(e.target.value) })}
                    />
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={feedback.synthetic}
                      onChange={(e) => setFeedback({ ...feedback, synthetic: e.target.checked })}
                    />
                    模拟读者反馈
                  </label>
                </>
              )}
              {error && <p role="alert">{error}</p>}
              {result && (
                <details open>
                  <summary>结果</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 300, overflow: 'auto' }}>{result}</pre>
                </details>
              )}
              <div className="modal-footer">
                <button type="button" onClick={() => setOpen(false)}>
                  取消
                </button>
                <button className="primary" disabled={busy}>
                  开始
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
