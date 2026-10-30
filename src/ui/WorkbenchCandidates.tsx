import { useEffect, useState } from 'react';
import type { CandidateView, WorkbenchScopeBinding } from '../shared/workbench-visual';
import { invokeCommand } from '../shared/client';
import { documentPreviewText } from '../shared/run-presentation';

function readable(content: string) {
  const match = content.match(/```json\s*([\s\S]*?)```/);
  if (!match || !/^# (?:世界|剧情|人物外观)/.test(content))
    return documentPreviewText(content)
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim();
  try {
    const data = JSON.parse(match[1]),
      lines: string[] = [];
    const names: Record<string, string> = {
      title: '名称',
      content: '内容',
      goal: '目标',
      obstacle: '阻力',
      choice: '选择',
      outcome: '结果',
      promise: '承诺',
      storyTime: '故事时间',
      scope: '适用范围',
      trigger: '触发条件',
      boundary: '边界',
      cost: '代价',
      exception: '例外',
      evidence: '证据',
      description: '描述',
      name: '图片',
      version: '版本',
      state: '状态',
      chapter: '章节',
      protected: '固定',
      locked: '固定'
    };
    const rows = [
      ...(data.modules ?? []),
      ...(data.scenes ?? []),
      ...(data.places ?? []),
      ...(data.avatars ?? [])
    ];
    for (const row of rows) {
      if (row.state && row.state !== 'enabled' && !row.content && !row.rule) continue;
      lines.push(
        Object.entries({ ...row, ...row.rule })
          .filter(([key, value]) => names[key] && String(value))
          .map(
            ([key, value]) =>
              `${names[key]}：${key === 'state' ? ({ enabled: '启用', disabled: '停用', undecided: '待定' } as Record<string, string>)[String(value)] : typeof value === 'boolean' ? (value ? '是' : '否') : value}`
          )
          .join('\n')
      );
    }
    for (const system of data.systems ?? []) {
      const stageTitle = (id: string) => system.steps.find((step: { id: string }) => step.id === id)?.title ?? '待核对阶段';
      lines.push([
        `成长体系：${system.title} · 第${system.version}版`,
        `状态：${({ enabled: '启用', disabled: '停用', undecided: '未定' } as Record<string, string>)[system.state]}；${system.locked ? '已固定' : '可修改'}`,
        `适用：${system.subjects.join('、') || '未限定人物或阵营'}；第${system.fromChapter}章起${system.toChapter === null ? '' : `，至第${system.toChapter}章`}`,
        ...system.steps.map((step: { title: string; ability: string; boundary: string; prerequisites: string[] }) =>
          `${step.title}：${step.ability || '能力未定'}；${step.boundary || '边界未定'}${step.prerequisites.length ? `；前置：${step.prerequisites.map(stageTitle).join('、')}` : ''}`),
        ...system.interactions.map((item: { targetSystemId: string; rule: string }) =>
          `与${data.systems.find((s: { id: string }) => s.id === item.targetSystemId)?.title ?? '待核对体系'}：${item.rule}`),
        ...(system.original ? [`导入原文：${system.original}`] : []),
        ...(system.unparsed.length ? [`待定内容：${system.unparsed.join('；')}`] : [])
      ].join('\n'));
    }
    const title = (id: string) =>
      rows.find((r) => r.id === id)?.title ??
      (/^chapter:\d+$/.test(id)
        ? `第 ${id.split(':')[1]} 章`
        : (rows.find((r) => `scene:${r.id}` === id)?.title ?? id));
    for (const link of [...(data.links ?? []), ...(data.routes ?? [])])
      lines.push(
        `${title(link.from)} → ${title(link.to)}：${link.label}${link.distance ? ` · ${link.distance.value} ${link.distance.unit}` : 'distance' in link ? ' · 距离未设定' : ''}${link.direction ? ` · ${link.direction}` : ''}${link.nonlinear ? ' · 非线性叙事' : ''}`
      );
    return lines.filter(Boolean).join('\n\n').replace(/<!--[\s\S]*?-->/g, '') || '未设定';
  } catch {
    return '资料暂不可读';
  }
}
export function WorkbenchCandidates({
  binding,
  enabled,
  nonce,
  focusId,
  profileId,
  refresh,
  onRun,
  onChange
}: {
  binding: WorkbenchScopeBinding;
  enabled: boolean;
  nonce: number;
  focusId?: string;
  profileId: string;
  refresh: () => Promise<void>;
  onRun: (id?: string) => void;
  onChange: () => void;
}) {
  const [items, setItems] = useState<CandidateView[]>([]),
    [open, setOpen] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const key = JSON.stringify(binding);
  useEffect(() => {
    let active = true;
    setItems([]);
    setError('');
    setNotice('');
    if (enabled)
      void invokeCommand('workbench.candidates', { binding })
        .then((v) => {
          if (active) {
            setItems(v);
            if (focusId && v.some((c) => c.id === focusId)) setOpen(focusId);
          }
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [key, enabled, nonce, focusId]);
  const act = async (work: () => Promise<void>) => {
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
  if (!enabled || (!items.length && !error && !notice)) return null;
  return (
    <section className="workbench-candidates" aria-label="画布修改候选">
      <h3>
        修改候选 <small>{items.length}</small>
      </h3>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {items.map((candidate) => (
        <details
          key={candidate.id}
          open={open === candidate.id}
          onToggle={(e) => {
            if (e.currentTarget.open) setOpen(candidate.id);
            else if (open === candidate.id) setOpen('');
          }}
        >
          <summary>
            {candidate.title}
            {candidate.stale ? ' · 需重新核对' : ''}
            {candidate.requiresRevision ? ' · 涉及正文' : ''}
          </summary>
          {candidate.groups.map((group) => (
            <section key={group.id} aria-label={group.title}>
              {group.changes.map((change) => (
                <details key={change.path} open={group.changes.length === 1}>
                  <summary>{change.path.split('/').at(-1)?.replace(/\.md$/, '')}</summary>
                  <div className="workbench-diff">
                    <div>
                      <h4>当前内容</h4>
                      <pre>{readable(change.before) || '未设定'}</pre>
                    </div>
                    <div>
                      <h4>修改内容</h4>
                      <pre>{readable(change.after) || '未设定'}</pre>
                    </div>
                  </div>
                </details>
              ))}
            </section>
          ))}
          <div className="object-actions">
            {candidate.requiresRevision ? (
              <button
                className="primary"
                disabled={busy || candidate.stale || !profileId}
                onClick={() =>
                  void act(async () => {
                    const id = await invokeCommand('run.reviewProse', {
                      id: candidate.id,
                      proposalHash: candidate.fingerprint,
                      profileId
                    });
                    await refresh();
                    onRun(id);
                  })
                }
              >
                核对正文与记忆
              </button>
            ) : (
              <button
                className="primary"
                disabled={busy || candidate.stale}
                onClick={() =>
                  void act(async () => {
                    await invokeCommand('workbench.accept', {
                      id: candidate.id,
                      fingerprint: candidate.fingerprint,
                      groups: candidate.groups.map((g) => g.id)
                    });
                    await refresh();
                    onChange();
                  })
                }
              >
                采纳{candidate.atomic && candidate.groups[0]?.changes.length > 1 ? '关联修改' : '此项'}
              </button>
            )}
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const draft = await invokeCommand('workbench.branch', {
                    id: candidate.id,
                    fingerprint: candidate.fingerprint,
                    title: `${candidate.title} · 分支`.slice(0, 80)
                  });
                  setNotice(`已保存分支：${draft.title}`);
                  await refresh();
                })
              }
            >
              保留分支
            </button>
            <button disabled={busy} onClick={() => onRun(candidate.id)}>
              继续讨论
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await invokeCommand('run.discard', { id: candidate.id });
                  await refresh();
                  onChange();
                })
              }
            >
              撤销候选
            </button>
          </div>
        </details>
      ))}
    </section>
  );
}
