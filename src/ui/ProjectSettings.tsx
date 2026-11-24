import { useState } from 'react';
import { stageIds, type Profile, type ProjectConfig } from '../shared/types';
import { stageLabels as names } from '../shared/project-progress';
import { normalizeWritingStyle } from '../shared/writing-style';
import { ExpressionSettings } from './ExpressionSettings';
import { WritingStyleField } from './WritingStyleField';
import { modelLabel } from './model-label';
import { Modal } from './Modal';
import { invokeCommand as invoke } from '../shared/client';
import type { Act } from './AppDialogs';

export function ProjectSettings({
  config,
  projectSessionId,
  initialProfileId,
  profiles,
  onClose,
  onPublishing,
  profileManaged,
  act
}: {
  config: ProjectConfig;
  projectSessionId?: string;
  initialProfileId: string;
  profiles: Profile[];
  onClose: () => void;
  onPublishing: () => void;
  profileManaged: boolean;
  act: Act;
}) {
  const [c, setC] = useState(config),
    [limitRounds, setLimitRounds] = useState(config.maxRounds !== 0),
    [styleBusy, setStyleBusy] = useState(false),
    [advanced, setAdvanced] = useState(JSON.stringify(config.stageProfiles, null, 2));
  const field = (key: keyof ProjectConfig, value: unknown) => setC((s) => ({ ...s, [key]: value }));
  return (
    <Modal title="作品设置" onClose={onClose} wide>
      <form
        className="modal-body form"
        onSubmit={(e) => {
          e.preventDefault();
          if (styleBusy) return;
          void act(async () => {
            await invoke('project.configure', { config: { ...c, maxRounds: limitRounds ? c.maxRounds : 0, style: normalizeWritingStyle(c.style), stageProfiles: JSON.parse(advanced) } });
            onClose();
          }, '作品设置已保存');
        }}
      >
        <div className="form-grid">
          {(
            [
              ['writing', '写作模型'],
              ['extraction', '记忆提取'],
              ['review', '质量评估']
            ] as const
          ).map(([key, label]) => (
            <label key={key}>
              {label}
              <select
                value={c.modelRouting[key]}
                onChange={(e) => field('modelRouting', { ...c.modelRouting, [key]: e.target.value })}
              >
                <option value="">{key === 'writing' ? '沿用本次模型' : '沿用写作模型'}</option>
                {profiles
                  .filter((p) => p.protocol !== 'images')
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {modelLabel(p, profiles)}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <label>
            视角人物
            <input
              value={c.viewpointCharacterId}
              onChange={(e) => field('viewpointCharacterId', e.target.value)}
              placeholder="人物编号或姓名"
            />
          </label>
          <label>
            正文生成方式
            <select value={c.proseMode ?? 'chapter'} onChange={e => field('proseMode', e.target.value)}>
              <option value="chapter">整章生成</option>
              <option value="scene">逐场生成（每场一次写作调用，需视角人物）</option>
            </select>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={c.preview.enabled}
              onChange={(e) => field('preview', { ...c.preview, enabled: e.target.checked })}
            />
            高级节奏评估（额外模型调用，按当前连接计费）
          </label>
          <label>
            每章过程评估上限（另有规划与成稿各一次）
            <input
              type="number"
              min={0}
              max={30}
              value={c.preview.maxCalls}
              onChange={(e) => field('preview', { ...c.preview, maxCalls: Number(e.target.value) })}
            />
          </label>
          {[
            ['targetWords', '目标总字数'],
            ['chapterWords', '单章目标字数'],
            ['minWords', '每章最少字数'],
            ['maxWords', '每章最多字数'],
            ['batchSize', '每批章数'],
            ['recentChapters', '近期变化窗口（章）'],
            ['maxTools', '任务最多工具调用']
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type="number"
                min={1}
                max={key === 'maxTools' ? 500 : undefined}
                value={c[key as keyof ProjectConfig] as number}
                id={`project-setting-${key}`}
                onChange={(e) => field(key as any, Number(e.target.value))}
              />
            </label>
          ))}
          <label className="check">
            <input type="checkbox" checked={!limitRounds}
              id={limitRounds ? undefined : 'project-setting-maxRounds'}
              onChange={e => {
                setLimitRounds(!e.target.checked);
                if (!e.target.checked && !c.maxRounds) field('maxRounds', 12);
              }} />
            不限模型轮数
          </label>
          {limitRounds && <label>
            任务最多模型轮数
            <input type="number" required min={1} max={100} id="project-setting-maxRounds"
              value={c.maxRounds || ''} onChange={e => field('maxRounds', Number(e.target.value))} />
          </label>}
          <label>
            叙述视角
            <input value={c.pov} onChange={(e) => field('pov', e.target.value)} />
          </label>
          <label>
            题材
            <input value={c.genre} readOnly={profileManaged} onChange={(e) => field('genre', e.target.value)} />
          </label>
        </div>
        <button type="button" onClick={onPublishing}>题材与发布分类</button>
        <WritingStyleField value={c.style} onChange={style => field('style', style)} projectSessionId={projectSessionId}
          profileId={projectSessionId ? c.modelRouting.writing || c.defaultProfileId || initialProfileId : ''} onBusyChange={setStyleBusy}
          context={{ premise: '', genre: c.genre, pov: c.pov, constraints: c.constraints }} />
        <ExpressionSettings value={c.expressionRules} onChange={(value) => field('expressionRules', value)} />
        <label>
          作者硬约束
          <textarea value={c.constraints} onChange={(e) => field('constraints', e.target.value)} />
        </label>
        <div className="form-grid">
          <label>
            默认模型
            <select value={c.defaultProfileId} onChange={(e) => field('defaultProfileId', e.target.value)}>
              <option value="">每次选择</option>
              {profiles
                .filter((p) => p.protocol !== 'images')
                .map((p) => (
                  <option key={p.id} value={p.id} title={`${p.name} · ${p.baseUrl}`}>
                    {modelLabel(p, profiles)}
                  </option>
                ))}
            </select>
          </label>
          <label>
            阶段费用上限（留空不限）
            <input
              type="number"
              min={0}
              step="any"
              value={c.stageBudget ?? ''}
              id="project-setting-stageBudget"
              onChange={(e) => field('stageBudget', e.target.value === '' ? null : Number(e.target.value))}
            />
          </label>
        </div>
        <label>
          自动备份目录
          <div className="input-action">
            <input readOnly value={c.backupDirectory} placeholder="未设置；本地历史始终保留" />
            <button
              type="button"
              onClick={() =>
                void act(async () => {
                  const value = await invoke('app.chooseDirectory');
                  if (value) field('backupDirectory', value);
                })
              }
            >
              选择
            </button>
            <button type="button" onClick={() => field('backupDirectory', '')}>
              清除
            </button>
          </div>
        </label>
        <details>
          <summary>按阶段指定模型（可选）</summary>
          {stageIds.map((s) => (
            <label key={s}>
              {s} {names[s]}
              <select
                value={c.stageProfiles[s] ?? ''}
                onChange={(e) => {
                  const stageProfiles = { ...c.stageProfiles };
                  if (e.target.value) stageProfiles[s] = e.target.value;
                  else delete stageProfiles[s];
                  setC({ ...c, stageProfiles });
                  setAdvanced(JSON.stringify(stageProfiles, null, 2));
                }}
              >
                <option value="">沿用默认 / 本次选择</option>
                {profiles
                  .filter((p) => p.protocol !== 'images')
                  .map((p) => (
                    <option key={p.id} value={p.id} title={`${p.name} · ${p.baseUrl}`}>
                      {modelLabel(p, profiles)}
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </details>
        <div className="modal-footer">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={styleBusy || !c.style.trim()}>保存设置</button>
        </div>
      </form>
    </Modal>
  );
}
