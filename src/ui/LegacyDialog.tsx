import { invokeCommand } from '../shared/client';
import { useState } from 'react';
import { configSchema, stageIds } from '../shared/types';
import type { Invoke } from '../shared/contracts';
import { commandContracts } from '../shared/contracts';
export function LegacyDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [source, setSource] = useState(''),
    [parent, setParent] = useState(''),
    [preview, setPreview] = useState<any>(null),
    [title, setTitle] = useState('导入的作品'),
    [chapter, setChapter] = useState(1),
    [stage, setStage] = useState('S01'),
    [error, setError] = useState(''),
    [agreed, setAgreed] = useState(false),
    [busy, setBusy] = useState(false);
  const call: Invoke = (c, a) => invokeCommand(c, a);
  async function choose() {
    try {
      const root = await call('app.chooseDirectory', { title: '选择原 Skill 创作档案目录' });
      if (root) {
        const result = await call('project.importLegacy', { preview: true, source: root });
        setSource(root);
        setPreview(result);
        if ('suggestedChapter' in result) setChapter(result.suggestedChapter);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <div className="scrim">
      <section className="modal wide" role="dialog" aria-label="导入旧 Skill 档案">
        <header>
          <div>
            <h2>导入旧 Skill 档案</h2>
            <p>创建独立副本，原目录及其字节保持不变。</p>
          </div>
          <button onClick={onClose}>关闭</button>
        </header>
        <div className="modal-body form">
          <button onClick={() => void choose()}>选择旧档案并预览</button>
          {preview && (
            <>
              <small>{source}</small>
              <label>
                作品名称
                <input value={title} onChange={(e) => setTitle(e.target.value)} />
              </label>
              <label>
                新作品保存位置
                <div className="input-action">
                  <input readOnly value={parent} />
                  <button onClick={() => void call('app.chooseDirectory').then((v) => v && setParent(v))}>
                    选择目录
                  </button>
                </div>
              </label>
              <div className="form-grid">
                <label>
                  继续章号
                  <input
                    type="number"
                    min={1}
                    value={chapter}
                    onChange={(e) => setChapter(Number(e.target.value))}
                  />
                </label>
                <label>
                  继续阶段
                  <select value={stage} onChange={(e) => setStage(e.target.value)}>
                    {stageIds.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </label>
              </div>
              <p className="info-box">
                已发现 {preview.files.length} 个 Markdown。默认容量沿用 300 万字、每章 2500 字、每批 30
                章；导入后可修改。S01—S11
                的意义请参照工作台阶段名称。继续位置由你明确指定，文件存在不视为已经完成审批。
              </p>
              {preview.warnings.map((w: string) => (
                <p className="inline-warning" key={w}>
                  {w}
                </p>
              ))}
              <details>
                <summary>查看完整文件清单</summary>
                {preview.files.map((f: any) => (
                  <p key={f.path}>
                    <b>{f.path}</b> · {f.bytes} bytes {f.warning && <small>{f.warning}</small>}
                  </p>
                ))}
              </details>
              <label className="check">
                <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                确认复制并采用上述继续位置；旧记忆需核对来源
              </label>
              <button
                className="primary"
                disabled={!agreed || !parent || busy}
                onClick={() => {
                  setBusy(true);
                  setError('');
                  void call('project.importLegacy', commandContracts['project.importLegacy'].input.parse({
                    source,
                    parent,
                    title,
                    chapter,
                    stage,
                    config: configSchema.parse({})
                  }))
                    .then(onDone)
                    .catch((e) => setError(e.message))
                    .finally(() => setBusy(false));
                }}
              >
                确认导入独立副本
              </button>
            </>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
