import { useEffect, useState } from 'react';
import type { CandidateView, WorkbenchScopeBinding } from '../shared/workbench-visual';
import { invokeCommand } from '../shared/client';
import { documentPreviewText } from '../shared/run-presentation';

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
                      <pre>{documentPreviewText(change.before) || '未设定'}</pre>
                    </div>
                    <div>
                      <h4>修改内容</h4>
                      <pre>{documentPreviewText(change.after) || '未设定'}</pre>
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
