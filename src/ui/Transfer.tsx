import { useState } from 'react';
import { Upload } from 'lucide-react';
import type { Snapshot } from '../shared/types';
import { brand } from '../shared/brand';
import { useDialogs } from './AppDialogs';
import { Modal } from './Modal';
import { invokeCommand as invoke } from '../shared/client';
import type { Act } from './AppDialogs';

export function Transfer({
  snapshot,
  act,
  onClose,
  onImport
}: {
  snapshot: Snapshot;
  act: Act;
  onClose: () => void;
  onImport: (file: string, content: string) => Promise<void>;
}) {
  const dialogs = useDialogs(snapshot.projectSessionId);
  const [preview, setPreview] = useState<{ content: string; warnings: string[]; name: string } | null>(null),
    [section, setSection] = useState<'import' | 'export' | 'backup'>('import'),
    [file, setFile] = useState(''),
    [checked, setChecked] = useState(false),
    [selection, setSelection] = useState(
      snapshot.documents.filter((d) => d.path.startsWith('07_')).map((d) => d.path)
    );
  return (
    <Modal
      title="导入、导出与备份"
      onClose={onClose}
      wide
    >
      {snapshot.project && <nav className="section-tabs" aria-label="文稿与备份操作">
        {([['import', '导入资料'], ['export', '导出文稿'], ['backup', '历史与备份']] as const).map(([id, label]) =>
          <button key={id} aria-pressed={section === id} onClick={() => setSection(id)}>{label}</button>)}
      </nav>}
      <div className="modal-body form transfer-body">
        {!snapshot.project ? (
          <>
            <p>导入文稿和导出需要先创建或打开作品。作品损坏时可直接恢复完整备份。</p>
            <button
              onClick={() =>
                void act(async () => {
                  const source = await invoke('app.chooseDirectory', {
                    title: `选择${brand.name}备份目录`
                  });
                  if (!source) return;
                  const parent = await invoke('app.chooseDirectory', {
                    title: '选择恢复位置'
                  });
                  if (parent) {
                    const result = await invoke('project.restoreBackup', { source, parent });
                    await dialogs.alert(`已恢复到新目录：${result}`);
                  }
                })
              }
            >
              校验备份并恢复到新目录
            </button>
          </>
        ) : (
          <>
            <section hidden={section !== 'import'}>
              <h3>导入文字资料</h3>
              <button
                onClick={() =>
                  void act(async () => {
                    const source = await invoke('app.chooseFile');
                    if (source) {
                      const p = await invoke('project.importDocument', { file: source });
                      setPreview(p);
                      setFile(`00_导入资料/${p.name}.md`);
                      setChecked(false);
                    }
                  })
                }
              >
                <Upload size={15} /><span>选择 MD / TXT / DOCX</span>
              </button>
              {preview && (
                <>
                  <label>
                    项目内保存路径
                    <input value={file} onChange={(e) => setFile(e.target.value)} />
                  </label>
                  {preview.warnings.map((w) => (
                    <p className="inline-warning" key={w}>
                      {w}
                    </p>
                  ))}
                  <textarea
                    rows={9}
                    value={preview.content}
                    onChange={(e) => setPreview({ ...preview, content: e.target.value })}
                  />
                  <label className="check">
                    <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                    已核对导入预览与可能丢失的排版
                  </label>
                  <button
                    className="primary"
                    disabled={!checked}
                    onClick={() => void onImport(file, preview.content)}
                  >
                    建立导入候选
                  </button>
                </>
              )}
            </section>
            <section hidden={section !== 'export'}>
              <h3>导出正式文稿</h3>
              <div className="export-list">
                {snapshot.documents.map((d) => (
                  <label className="check" key={d.path}>
                    <input
                      type="checkbox"
                      checked={selection.includes(d.path)}
                      onChange={(e) =>
                        setSelection(
                          e.target.checked ? [...selection, d.path] : selection.filter((x) => x !== d.path)
                        )
                      }
                    />
                    {d.path}
                  </label>
                ))}
              </div>
              <button
                disabled={!selection.length}
                onClick={() =>
                  void act(async () => {
                    const target = await invoke('app.chooseFile', {
                      save: true,
                      name: `${snapshot.project!.title}.docx`
                    });
                    if (target) return invoke('project.export', { paths: selection, target });
                  }, '导出完成')
                }
              >
                选择格式和位置并导出
              </button>
            </section>
            <section hidden={section !== 'backup'}>
              <h3>历史与备份</h3>
              <div className="button-row">
                <button
                  onClick={() =>
                    void act(async () => {
                      const files = await invoke('project.repair', { preview: true });
                      if (Array.isArray(files) && await dialogs.confirm('以下文件将作为修复候选，已有文稿不会覆盖：\n' + files.join('\n')))
                        await invoke('project.repair');
                    }, '修复候选已建立，请回工作台审阅')
                  }
                >
                  预览并修复缺失模板 / 索引
                </button>
                <button
                  onClick={() =>
                    void act(async () => {
                      const report = await invoke('diagnostics.export');
                      const blob = new Blob([report], { type: 'application/json' });
                      const url = URL.createObjectURL(blob),
                        a = document.createElement('a');
                      a.href = url;
                      a.download = `${brand.name}诊断.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    })
                  }
                >
                  导出脱敏诊断
                </button>
              </div>
              <p className="muted">
                每次提交都保留本地历史。完整备份包含正式文件、候选、记忆、历史对象和运行记录，不含 API Key。
              </p>
              <div className="button-row">
                <button
                  onClick={() =>
                    void act(async () => {
                      const directory = await invoke('app.chooseDirectory', {
                        title: '选择备份目录'
                      });
                      if (directory) {
                        const target = await invoke('project.backup', { directory });
                        await dialogs.alert(`备份已保存：${target}`);
                      }
                    })
                  }
                >
                  立即完整备份
                </button>
                <button
                  onClick={() =>
                    void act(async () => {
                      const source = await invoke('app.chooseDirectory', {
                        title: `选择${brand.name}备份目录`
                      });
                      if (!source) return;
                      const parent = await invoke('app.chooseDirectory', {
                        title: '选择恢复位置（创建新目录）'
                      });
                      if (parent) {
                        const result = await invoke('project.restoreBackup', { source, parent });
                        await dialogs.alert(`已恢复到新目录：${result}`);
                      }
                    })
                  }
                >
                  校验并恢复备份
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </Modal>
  );
}
