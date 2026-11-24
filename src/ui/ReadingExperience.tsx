import { useEffect, useRef, useState } from 'react';
import { invokeCommand } from '../shared/client';
import type { CommandOutput } from '../shared/contracts';
import { maxExperienceChapter } from '../shared/experience';

export function ReadingExperience() {
  const [through, setThrough] = useState(1),
    [data, setData] = useState<CommandOutput<'experience.read'>>(),
    [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  useEffect(() => {
    generation.current++;
    setData(undefined); setLoading(false);
    let active = true;
    if (!Number.isInteger(through) || through < 1 || through > maxExperienceChapter) return;
    void invokeCommand('experience.read', { throughChapter: through })
      .then((value) => {
        if (active) {
          setData(value);
          setError('');
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [through]);
  const loadOlder = async () => {
    if (!data?.firstReadPage?.nextBefore || loading) return;
    const epoch = generation.current;
    setLoading(true);
    try {
      const value = await invokeCommand('experience.read', { throughChapter: through,
        before: data.firstReadPage.nextBefore, watermark: data.firstReadPage.watermark });
      if (epoch !== generation.current) return;
      setData(previous => {
        if (!previous) return value;
        const chapters = new Map(previous.chapters.map(chapter => [chapter.chapter, chapter]));
        for (const chapter of value.chapters) {
          const existing = chapters.get(chapter.chapter);
          chapters.set(chapter.chapter, { ...chapter, simulated: [...new Map([...(existing?.simulated ?? []), ...chapter.simulated].map(item => [item.id, item])).values()] });
        }
        return { ...value, chapters: [...chapters.values()].sort((a, b) => a.chapter - b.chapter) };
      });
      setError('');
    } catch (error) { if (epoch === generation.current) setError((error as Error).message); }
    finally { if (epoch === generation.current) setLoading(false); }
  };
  const chapters = data?.chapters.filter(c => c.planned.length + c.realized.length + c.simulated.length + c.feedback.length > 0) ?? [];
  return (
    <>
      <label>
        查看至第几章
        <input
          type="number"
          min={1}
          max={maxExperienceChapter}
          value={through}
          onChange={(e) => setThrough(Number(e.target.value))}
        />
      </label>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {data?.characters.length ? (
        <details>
          <summary>人物状态</summary>
          <div className="quality-cards">
            {data.characters.map((c) => (
              <article key={c.id}>
                <h3>{c.name}</h3>
                <div className="quality-grid">
                  {([['stable', '稳定设定'], ['current', '当下状态'], ['experiences', '已发生经历']] as const)
                    .filter(([key]) => c[key].length > 0)
                    .map(([key, label]) => <div key={key}><h4>{label}</h4>{c[key].map(item => <p key={item.id}>{item.text}</p>)}</div>)}
                </div>
              </article>
            ))}
          </div>
        </details>
      ) : null}
      <div className="quality-cards">
        {chapters.map((c) => (
            <article key={c.chapter}>
              <h3>第 {c.chapter} 章</h3>
              <div className="quality-grid">
                {(
                  [
                    ['planned', '作者计划'],
                    ['realized', '正文证据'],
                    ['simulated', '模型首读'],
                    ['feedback', '本章读者反馈']
                  ] as const
                ).filter(([key]) => c[key].length > 0).map(([key, label]) => (
                  <div key={key}>
                    <h4>{label}</h4>
                    {c[key].map((item) => (
                      <details key={item.id}>
                        <summary>
                          {item.stale ? '待复核 · ' : ''}
                          {item.text.slice(0, 45)}
                        </summary>
                        <div className="quality-prose">{item.text}</div>
                        {item.source && <span>{item.source.split('/').at(-1)}</span>}
                      </details>
                    ))}
                  </div>
                ))}
              </div>
            </article>
          ))}
      </div>
      {data && !chapters.length && !data.characters.length && !data.feedback.length && <p className="empty-state">截至第 {through} 章，还没有试读记录。</p>}
      {!!data?.feedback.length && <section><h3>作品试读 · 真人反馈</h3>{data.feedback.map(item => <p key={item.id}>{item.text}</p>)}</section>}
      {data?.firstReadPage?.nextBefore && <button disabled={loading} onClick={() => void loadOlder()}>{loading ? '加载中…' : '加载更早的初读记录'}</button>}
    </>
  );
}
