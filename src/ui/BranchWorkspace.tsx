import { useEffect, useState } from 'react';
import { invokeCommand } from '../shared/client';
import type { CommandOutput } from '../shared/contracts';
const displayTime = (value: string) => new Date(value).toLocaleString('zh-CN', { hour12: false });

export function BranchWorkspace({ onRun }: { onRun: (id: string) => void }) {
  const [drafts, setDrafts] = useState<CommandOutput<'draft.list'>>([]),
    [current, setCurrent] = useState<CommandOutput<'draft.read'>>();
  const [comparison, setComparison] = useState<CommandOutput<'draft.read'>>(),
    [content, setContent] = useState(''),
    [version, setVersion] = useState('');
  const [chapter, setChapter] = useState(1),
    [mode, setMode] = useState<'replace' | 'append'>('replace');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<unknown>) => {
    setError('');
    setBusy(true);
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const load = async (id: string, hash?: string) => {
    const value = await invokeCommand('draft.read', { id, ...(hash ? { hash } : {}) });
    setCurrent(value);
    setVersion(hash ?? value.hash);
    setContent(value.content);
  };
  useEffect(() => {
    void act(async () => setDrafts(await invokeCommand('draft.list')));
  }, []);
  return (
    <fieldset disabled={busy}>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="quality-grid">
        <label>
          创作分支
          <select aria-label="创作分支" value={current?.id ?? ''} onChange={(e) => void act(() => load(e.target.value))}>
            <option value="">选择草稿</option>
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.title} · {displayTime(d.updatedAt)}
              </option>
            ))}
          </select>
        </label>
        {current && (
          <label>
            版本
            <select aria-label="版本" value={version} onChange={(e) => void act(() => load(current.id, e.target.value))}>
              {current.versions.map((v) => (
                <option key={v.hash} value={v.hash}>
                  {displayTime(v.at)}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          对照分支
          <select
            aria-label="对照分支"
            value={comparison?.id ?? ''}
            onChange={(e) =>
              void act(async () =>
                setComparison(
                  e.target.value ? await invokeCommand('draft.read', { id: e.target.value }) : undefined
                )
              )
            }
          >
            <option value="">不比较</option>
            {drafts
              .filter((d) => d.id !== current?.id)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title} · {displayTime(d.updatedAt)}
                </option>
              ))}
          </select>
        </label>
      </div>
      {current && (
        <>
          <div className="quality-grid">
            <label>
              分支正文
              <textarea
                aria-label="分支正文"
                className="branch-editor"
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            </label>
            {comparison && (
              <article>
                <h3>{comparison.title}</h3>
                <div className="quality-prose">{comparison.content}</div>
              </article>
            )}
          </div>
          <div className="quality-actions">
            <button
              onClick={() =>
                void act(async () => {
                  const latest = await invokeCommand('draft.read', { id: current.id });
                  if (latest.hash !== current.hash || latest.currentHash !== current.hash) throw new Error('草稿已更新，请重新读取');
                  const saved = await invokeCommand('draft.save', {
                    id: current.id,
                    title: current.title,
                    content,
                    baseHash: latest.currentHash,
                    conversationId: current.conversationId,
                    messageId: current.messageId
                  });
                  setDrafts(await invokeCommand('draft.list'));
                  await load(saved.id);
                })
              }
            >
              保存此版本
            </button>
            <button
              onClick={() =>
                void act(async () => {
                  const fork = await invokeCommand('draft.fork', {
                    id: current.id,
                    hash: version,
                    title: `${current.title.slice(0, 60)} · 分支`
                  });
                  setDrafts(await invokeCommand('draft.list'));
                  await load(fork.id);
                })
              }
            >
              从此版本分支
            </button>
          </div>
          <div className="quality-grid">
            <label>
              合并到第几章
              <input
                type="number"
                min={1}
                value={chapter}
                onChange={(e) => setChapter(Number(e.target.value))}
              />
            </label>
            <label>
              合并方式
              <select aria-label="合并方式" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="replace">替换本章</option>
                <option value="append">追加到章末</option>
              </select>
            </label>
          </div>
          <button
            disabled={content !== current.content || version !== current.hash}
            onClick={() =>
              void act(async () => {
                const data = await invokeCommand('resource.read', { resources: ['documents'] }),
                  path = `07_正文章节/第${String(chapter).padStart(3, '0')}章.md`;
                onRun(
                  await invokeCommand('draft.merge', {
                    id: current.id,
                    hash: current.currentHash,
                    chapter,
                    baseHash: data.documents?.find((d) => d.path === path)?.hash ?? null,
                    mode
                  })
                );
              })
            }
          >
            转为正文候选
          </button>
        </>
      )}
    </fieldset>
  );
}
