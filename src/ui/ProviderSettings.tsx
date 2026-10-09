import { useEffect, useRef, useState } from 'react';
import { Plus, RefreshCw, Search, Server, X } from 'lucide-react';
import { profileSchema, type Command, type ModelCatalog, type Profile } from '../shared/types';
import { connectionId, connectionFields, modelFields, providerGroups } from '../shared/provider-groups';
import { applyModelLimits, officialModelLimits } from '../shared/model-limits';
import { DeleteButton } from './DeleteButton';

type Act = <T>(fn: () => Promise<T>, success?: string) => Promise<T | undefined>;
const invoke = <T,>(command: Command, args: Record<string, unknown> = {}) =>
  window.wenxu!.invoke<T>(command, args);
const fresh = (): Profile => ({
  ...profileSchema.parse({
    id: crypto.randomUUID(),
    name: '新供应商',
    protocol: 'responses',
    baseUrl: 'https://api.openai.com/v1',
    model: 'unselected'
  }),
  baseUrl: '',
  model: ''
});
const draftMap = (group: Profile[]) => Object.fromEntries(group.map((p) => [p.model, p]));
const activeModels = (group: Profile[]) =>
  group.filter((p) => p.enabled !== false && p.model).map((p) => p.model);
const fingerprint = (
  connection: Profile,
  models: Record<string, Profile>,
  selected: string[],
  headers: string
) =>
  JSON.stringify({
    connection: connectionFields(connection),
    headers,
    models: [...selected].sort().map((id) => modelFields(models[id]))
  });
const errorText = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    ''
  );

export function ProviderSettings({
  profiles,
  onClose,
  act
}: {
  profiles: Profile[];
  onClose: () => void;
  act: Act;
}) {
  const groups = providerGroups(profiles);
  const initialGroup = groups[0] ?? [];
  const [connection, setConnection] = useState<Profile>(() => initialGroup[0] ?? fresh());
  const [models, setModels] = useState<Record<string, Profile>>(() => draftMap(initialGroup));
  const [selected, setSelected] = useState<string[]>(() => activeModels(initialGroup));
  const [editingModel, setEditingModel] = useState(() => activeModels(initialGroup)[0] ?? '');
  const [savedGroup, setSavedGroup] = useState(initialGroup);
  const [baseline, setBaseline] = useState<string | null>(() =>
    initialGroup.length
      ? fingerprint(
          initialGroup[0],
          draftMap(initialGroup),
          activeModels(initialGroup),
          JSON.stringify(initialGroup[0].headers, null, 2)
        )
      : null
  );
  const [manualModel, setManualModel] = useState('');
  const p = {
    ...connection,
    ...(models[editingModel] ?? {}),
    ...connectionFields(connection),
    id: connection.id,
    connectionId: connectionId(connection),
    hasKey: connection.hasKey,
    model: editingModel
  };
  const [key, setKey] = useState('');
  const [headerText, setHeaderText] = useState(() => JSON.stringify(profiles[0]?.headers ?? {}, null, 2));
  const [catalog, setCatalog] = useState<ModelCatalog>({ models: [], truncated: false });
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [automatic, setAutomatic] = useState(true);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState('');
  const [formError, setFormError] = useState('');
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastRequested = useRef('');
  const mounted = useRef(true);
  const dirty = !baseline || !!key || fingerprint(connection, models, selected, headerText) !== baseline;
  const connectionToken = JSON.stringify([connection.id, p.baseUrl, p.protocol, p.proxy, headerText, key]);
  const currentToken = useRef(connectionToken);
  currentToken.current = connectionToken;
  const update = (field: keyof Profile, value: unknown) => {
    if (['name', 'protocol', 'baseUrl', 'proxy'].includes(field)) {
      setConnection((v) => ({ ...v, [field]: value }));
      if (field === 'protocol' || field === 'baseUrl') {
        const protocol = field === 'protocol' ? (value as Profile['protocol']) : connection.protocol;
        setModels((v) =>
          Object.fromEntries(
            Object.entries(v).map(([id, row]) => [
              id,
              applyModelLimits({ ...row, protocol }, officialModelLimits(id, protocol))
            ])
          )
        );
      }
    } else if (editingModel)
      setModels((v) => {
        const changed = { ...v[editingModel], [field]: value };
        return {
          ...v,
          [editingModel]:
            field === 'limitMode'
              ? applyModelLimits(
                  changed,
                  catalog.models.find((m) => m.id === editingModel)?.limits ??
                    changed.modelLimits ??
                    officialModelLimits(editingModel, connection.protocol)
                )
              : changed
        };
      });
    setResult('');
    setFormError('');
  };
  const newModel = (id: string) =>
    applyModelLimits(
      profileSchema.parse({
        id: connection.id,
        name: connection.name || '供应商',
        protocol: connection.protocol,
        baseUrl: 'https://example.invalid/v1',
        model: id,
        limitMode: 'official'
      }),
      catalog.models.find((m) => m.id === id)?.limits ?? officialModelLimits(id, connection.protocol)
    );
  function selectModels(ids: string[], enabled: boolean) {
    const next = enabled ? [...new Set([...selected, ...ids])] : selected.filter((id) => !ids.includes(id));
    setModels((old) =>
      Object.fromEntries(
        [...new Set([...Object.keys(old), ...ids])].map((id) => [
          id,
          Object.hasOwn(old, id) ? old[id] : newModel(id)
        ])
      )
    );
    setSelected(next);
    if (!next.includes(editingModel)) setEditingModel(next[0] ?? '');
    setResult('');
    setFormError('');
  }
  function loadGroup(group: Profile[], saved: boolean, preferred?: string) {
    const base = group[0] ?? fresh(),
      map = draftMap(group),
      enabled = activeModels(group);
    const headers = JSON.stringify(base.headers, null, 2);
    setConnection(base);
    setModels(map);
    setSelected(enabled);
    setEditingModel(preferred && enabled.includes(preferred) ? preferred : (enabled[0] ?? ''));
    setSavedGroup(saved ? group : []);
    setBaseline(saved ? fingerprint(base, map, enabled, headers) : null);
    setHeaderText(headers);
    setKey('');
    setManualModel('');
    setResult('');
    setFormError('');
  }
  const ready = (() => {
    try {
      return ['http:', 'https:'].includes(new URL(p.baseUrl).protocol);
    } catch {
      return false;
    }
  })();

  async function readModels() {
    if (!ready) {
      setLoadError('请先填写完整的 API 根地址');
      setLoadState('error');
      return;
    }
    clearTimeout(timer.current);
    const token = connectionToken,
      request = ++generation.current;
    lastRequested.current = token;
    setLoadState('loading');
    setLoadError('');
    try {
      let headers: unknown;
      try {
        headers = JSON.parse(headerText);
      } catch {
        throw new Error('自定义请求头必须是有效 JSON');
      }
      const data = await invoke<ModelCatalog>('profiles.models', {
        id: p.id,
        connection: { protocol: p.protocol, baseUrl: p.baseUrl.trim(), proxy: p.proxy, headers },
        apiKey: key
      });
      if (!mounted.current || generation.current !== request || currentToken.current !== token) return;
      setCatalog(data);
      setModels((old) =>
        Object.fromEntries(
          Object.entries(old).map(([id, row]) => [
            id,
            applyModelLimits(
              row,
              data.models.find((m) => m.id === id)?.limits ??
                officialModelLimits(id, p.protocol) ??
                row.modelLimits
            )
          ])
        )
      );
      setLoadState('ready');
    } catch (e) {
      if (!mounted.current || generation.current !== request || currentToken.current !== token) return;
      setCatalog({ models: [], truncated: false });
      setLoadError(errorText(e));
      setLoadState('error');
    }
  }
  const autoAction = useRef(() => {});
  autoAction.current = () => {
    if (automatic && ready && (key.trim() || p.hasKey) && lastRequested.current !== connectionToken)
      void readModels();
  };
  const scheduleAuto = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => autoAction.current(), 650);
  };
  useEffect(() => {
    generation.current++;
    lastRequested.current = '';
    setCatalog({ models: [], truncated: false });
    setLoadState('idle');
    setLoadError('');
  }, [connectionToken]);
  useEffect(() => {
    scheduleAuto();
  }, [p.id, automatic]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      clearTimeout(timer.current);
    };
  }, []);

  function choose(group: Profile[], saved: boolean) {
    if (working || (dirty && !confirm('当前连接有未保存的修改，放弃这些修改？'))) return;
    generation.current++;
    clearTimeout(timer.current);
    loadGroup(group, saved);
    setSearch('');
    setResult('');
    setFormError('');
  }
  function close() {
    if (!working && (!dirty || confirm('连接修改尚未保存，放弃修改并关闭？'))) onClose();
  }
  async function deleteGroup(group: Profile[]) {
    const id = connectionId(group[0]);
    setWorking(true);
    try {
      const removed = await act(async () => {
        await invoke('profiles.deleteGroup', { id });
        if (connectionId(connection) === id) {
          generation.current++;
          clearTimeout(timer.current);
          const next = groups.find((v) => connectionId(v[0]) !== id);
          loadGroup(next ?? [], !!next);
          setResult('');
          setSearch('');
          setFormError('');
        }
        return true;
      }, '供应商及其模型配置已删除');
      return removed === true;
    } finally {
      if (mounted.current) setWorking(false);
    }
  }
  async function save() {
    setWorking(true);
    setFormError('');
    setResult('');
    await act(async () => {
      try {
        const saved = await invoke<Profile[]>('profiles.saveGroup', {
          connection: {
            ...connectionFields(connection),
            name: p.name.trim(),
            baseUrl: p.baseUrl.trim(),
            headers: JSON.parse(headerText)
          },
          models: selected.map((id) => modelFields(models[id])),
          apiKey: key
        });
        if (!mounted.current) return;
        loadGroup(saved, true, editingModel);
        scheduleAuto();
        setResult(`已保存 ${selected.length} 个模型，可在写作区分别选择。`);
      } catch (e) {
        setFormError(errorText(e));
        throw e;
      }
    }, '模型配置已保存');
    if (mounted.current) setWorking(false);
  }
  async function testConnection(tools: boolean) {
    if (dirty) {
      setFormError('请先保存当前配置，再测试选中的模型');
      return;
    }
    setWorking(true);
    setFormError('');
    setResult('');
    await act(async () => {
      try {
        const target = savedGroup.find((v) => v.model === editingModel && v.enabled !== false);
        if (!target) throw new Error('请先选择并保存要测试的模型');
        const r = await invoke<{ text: string }>('profiles.test', { id: target.id, tools });
        if (mounted.current) setResult(`${p.model} · ${tools ? '工具续轮' : '文字'}测试通过：${r.text}`);
      } catch (e) {
        if (mounted.current) setFormError(errorText(e));
        throw e;
      }
    });
    if (mounted.current) setWorking(false);
  }
  const visible = catalog.models.filter((m) =>
    `${m.id} ${m.name} ${m.owner}`.toLowerCase().includes(search.trim().toLowerCase())
  );
  const unresolvedModels =
    p.protocol === 'images'
      ? []
      : selected.filter((id) => models[id].limitMode === 'official' && !models[id].modelLimits);
  const automaticLimits = p.limitMode === 'official';
  const limitsKnown = !automaticLimits || !!p.modelLimits;
  return (
    <div
      className="scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <section className="modal wide provider-dialog" role="dialog" aria-modal="true" aria-label="模型与连接">
        <header>
          <div>
            <h2>模型与连接</h2>
            <p>一个供应商可启用多个模型，写作时再选择本次使用哪一个。</p>
          </div>
          <button className="icon" onClick={close} disabled={working} aria-label="关闭">
            <X size={19} />
          </button>
        </header>
        <div className="settings-layout provider-layout">
          <aside aria-label="供应商连接">
            <div className="provider-side-title">
              供应商 <span>{groups.length}</span>
            </div>
            {groups.map((group) => {
              const v = group[0];
              return (
                <div className="provider-list-row" key={connectionId(v)}>
                  <button
                    type="button"
                    disabled={working}
                    className={connectionId(p) === connectionId(v) ? 'active' : ''}
                    aria-pressed={connectionId(p) === connectionId(v)}
                    onClick={() => choose(group, true)}
                  >
                    <Server size={15} />
                    <span>
                      {v.name}
                      <small>{activeModels(group).length} 个已选模型</small>
                    </span>
                  </button>
                  <DeleteButton
                    compact
                    disabled={working}
                    label={`删除供应商 ${v.name}`}
                    description={`删除「${v.name}」的全部模型配置及保存的密钥，相关任务需重新选择模型。${connectionId(p) === connectionId(v) && dirty ? '本连接未保存的修改也会丢弃。' : ''}`}
                    onConfirm={() => deleteGroup(group)}
                  />
                </div>
              );
            })}
            {!baseline && (
              <div className="provider-draft">
                {p.name}
                <small>尚未保存</small>
              </div>
            )}
            <button
              type="button"
              className="provider-add"
              disabled={working}
              onClick={() => choose([], false)}
            >
              <Plus size={15} /> 添加供应商
            </button>
            <p className="provider-side-note">每个供应商共用连接和密钥；模型参数与能力测试分别保存。</p>
          </aside>
          <form
            className="form provider-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (!working) void save();
            }}
          >
            <fieldset className="provider-fields" disabled={working}>
              <div className="provider-section-title">
                <span>01</span>
                <h3>供应商连接</h3>
                {dirty && <small>未保存</small>}
              </div>
              <div className="form-grid">
                <label>
                  供应商名称
                  <input
                    value={p.name}
                    required
                    onChange={(e) => update('name', e.target.value)}
                    placeholder="例如：本机 Sub2API"
                  />
                </label>
                <label>
                  接口协议
                  <select
                    value={p.protocol}
                    onBlur={scheduleAuto}
                    onChange={(e) => update('protocol', e.target.value)}
                  >
                    <option value="responses">OpenAI Responses</option>
                    <option value="chat">OpenAI Chat Completions</option>
                    <option value="anthropic">Anthropic Messages</option>
                    <option value="gemini">Gemini 原生</option>
                    <option value="images">Images · 封面</option>
                  </select>
                </label>
              </div>
              <label>
                API 根地址
                <input
                  type="url"
                  required
                  value={p.baseUrl}
                  onBlur={scheduleAuto}
                  onChange={(e) => update('baseUrl', e.target.value)}
                  placeholder={
                    p.protocol === 'gemini'
                      ? 'https://generativelanguage.googleapis.com/v1beta'
                      : 'http://127.0.0.1:8080/v1'
                  }
                />
                <small>填写接口根地址，不是管理后台网址，也不需要填写 /models。</small>
              </label>
              <label>
                API Key{' '}
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onBlur={scheduleAuto}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setResult('');
                  }}
                  placeholder={
                    p.hasKey ? '密钥已加密保存；留空保留原密钥' : '填写供应商密钥；无认证的本地服务可留空'
                  }
                />
                <small>
                  {p.hasKey
                    ? '已保存密钥不会在界面回显。改变根地址后需重新填写密钥。'
                    : '密钥由 Windows 加密保存在本机。'}
                </small>
              </label>
              <div className="provider-section-title">
                <span>02</span>
                <h3>选择模型</h3>
                <small>
                  已选 {selected.length} 个{loadState === 'ready' ? ` · ${catalog.models.length} 个可选` : ''}
                </small>
              </div>
              <div className="model-catalog">
                <div className="catalog-toolbar">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={automatic}
                      onChange={(e) => setAutomatic(e.target.checked)}
                    />
                    自动获取模型列表
                  </label>
                  <button
                    type="button"
                    onClick={() => void readModels()}
                    disabled={!ready || loadState === 'loading'}
                  >
                    <RefreshCw size={14} className={loadState === 'loading' ? 'spin' : ''} />
                    {loadState === 'loading' ? '正在获取…' : '获取 / 刷新'}
                  </button>
                </div>
                <label className="catalog-search">
                  <Search size={16} />
                  <input
                    aria-label="搜索模型"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="搜索模型名称或供应商"
                  />
                </label>
                <div
                  className="catalog-models"
                  role="group"
                  aria-label="供应商模型列表"
                  aria-busy={loadState === 'loading'}
                >
                  {loadState === 'loading' && (
                    <p className="catalog-empty" role="status">
                      正在读取供应商模型列表…
                    </p>
                  )}
                  {loadState === 'error' && (
                    <p className="catalog-error" role="alert">
                      {loadError}
                    </p>
                  )}
                  {loadState === 'idle' && (
                    <p className="catalog-empty">填好地址和密钥后自动读取，也可点击“获取 / 刷新”。</p>
                  )}
                  {loadState === 'ready' && !visible.length && (
                    <p className="catalog-empty">
                      {catalog.models.length
                        ? '没有匹配的模型，请调整搜索词。'
                        : '供应商没有返回可选模型。你仍可在下方手动填写。'}
                    </p>
                  )}
                  {loadState === 'ready' &&
                    visible.map((m) => (
                      <label
                        key={m.id}
                        className={`catalog-model ${selected.includes(m.id) ? 'selected' : ''}`}
                      >
                        <input
                          type="checkbox"
                          aria-label={`选择模型 ${m.id}`}
                          checked={selected.includes(m.id)}
                          onChange={(e) => selectModels([m.id], e.target.checked)}
                        />
                        <span>
                          <strong>{m.id}</strong>
                          {m.name !== m.id && <small>{m.name}</small>}
                        </span>
                        {m.owner && <em>{m.owner}</em>}
                      </label>
                    ))}
                </div>
                {catalog.truncated && (
                  <p className="catalog-warning">
                    列表较大或分页异常，当前仅展示部分模型；可手动填写未列出的模型。
                  </p>
                )}
              </div>
              <div className="button-row">
                <button
                  type="button"
                  disabled={!visible.length}
                  onClick={() =>
                    selectModels(
                      visible.map((m) => m.id),
                      true
                    )
                  }
                >
                  全选当前结果
                </button>
                <button
                  type="button"
                  disabled={!visible.length}
                  onClick={() =>
                    selectModels(
                      visible.map((m) => m.id),
                      false
                    )
                  }
                >
                  取消当前结果
                </button>
              </div>
              <div className="model-selection" aria-label="已选模型">
                {selected.map((id) => (
                  <span key={id} className="selected-model-chip">
                    <span title={id}>{id}</span>
                    <button
                      type="button"
                      aria-label={`取消选择 ${id}`}
                      onClick={() => selectModels([id], false)}
                    >
                      <X size={13} />
                    </button>
                  </span>
                ))}
                {!selected.length && <small>请至少选择一个模型后保存。</small>}
              </div>
              <div className="manual-model-row">
                <label>
                  手动添加模型 ID
                  <input
                    value={manualModel}
                    maxLength={512}
                    onChange={(e) => setManualModel(e.target.value)}
                    placeholder="未列出的模型也可以手动添加"
                  />
                </label>
                <button
                  type="button"
                  disabled={!manualModel.trim()}
                  onClick={() => {
                    const id = manualModel.trim();
                    selectModels([id], true);
                    setEditingModel(id);
                    setManualModel('');
                  }}
                >
                  添加
                </button>
              </div>
              <small>
                刷新或搜索不会清空已选项。取消勾选只停用模型并保留其配置；原任务需重新启用该模型或改选后继续。
              </small>
              <details>
                <summary>高级连接设置（所有已选模型共用）</summary>
                <label>
                  代理地址
                  <input
                    value={p.proxy}
                    onBlur={scheduleAuto}
                    onChange={(e) => update('proxy', e.target.value)}
                    placeholder="http://127.0.0.1:端口"
                  />
                </label>
                <label>
                  非敏感请求头 JSON
                  <textarea
                    onBlur={scheduleAuto}
                    value={headerText}
                    onChange={(e) => setHeaderText(e.target.value)}
                  />
                </label>
              </details>
              <div className="provider-section-title">
                <span>03</span>
                <h3>单个模型参数与测试</h3>
              </div>
              <label>
                正在配置的模型
                <select
                  value={editingModel}
                  onChange={(e) => {
                    setEditingModel(e.target.value);
                    setResult('');
                  }}
                  disabled={!selected.length}
                >
                  {!selected.length && <option value="">先选择模型</option>}
                  {selected.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
                <small>新选模型默认跟随官方上限，参数独立保存；价格仍按你的实际服务填写。</small>
              </label>
              <fieldset className="provider-model-fields" disabled={!editingModel}>
                {p.protocol === 'images' && (
                  <div className="form-grid">
                    <label>
                      图像尺寸
                      <input value={p.imageSize} onChange={(e) => update('imageSize', e.target.value)} />
                    </label>
                    <label>
                      图像质量
                      <input
                        value={p.imageQuality}
                        onChange={(e) => update('imageQuality', e.target.value)}
                      />
                    </label>
                  </div>
                )}
                {p.protocol !== 'images' && (
                  <>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={automaticLimits}
                        onChange={(e) => update('limitMode', e.target.checked ? 'official' : 'manual')}
                      />
                      跟随官方上限（默认）
                    </label>
                    <div className="model-limit-status" role="status">
                      {p.modelLimits ? (
                        <>
                          <strong>
                            {automaticLimits ? '已按官方最大值配置' : '手动配置 · 官方规格供参考'}
                          </strong>
                          <small>
                            来源：
                            {p.modelLimits.origin === 'official-api' ? '官方模型接口' : '已核实的官方文档'} ·
                            核实日期 {p.modelLimits.checkedAt}
                          </small>
                          <small className="model-limit-source">{p.modelLimits.source}</small>
                          {p.modelLimits.windowKind === 'separate' && (
                            <small>
                              此模型分别限制输入与输出；下面的总容量为两者相加的本地预算，不是厂商声明的共享窗口。
                            </small>
                          )}
                          {p.modelLimits.note && <small>{p.modelLimits.note}</small>}
                          <small>
                            中转可能另有限制；不满足时可关闭跟随并手动调整。官方规格不代表此连接已通过能力测试。
                          </small>
                        </>
                      ) : (
                        <>
                          <strong>
                            {automaticLimits ? '官方上限尚未核实' : '手动参数 · 未核实官方上限'}
                          </strong>
                          <small>
                            请刷新模型列表。若仍未匹配，请关闭跟随并填写供应商确认的参数；客户端不会将通用初始值标作官方规格。
                          </small>
                        </>
                      )}
                    </div>
                    <div className="form-grid">
                      <label>
                        {p.modelLimits?.windowKind === 'separate'
                          ? '输入与输出预算总和（tokens）'
                          : '上下文容量（tokens）'}
                        <input
                          type="number"
                          min={1024}
                          readOnly={automaticLimits}
                          placeholder="尚未核实"
                          value={limitsKnown ? p.contextLimit : ''}
                          onChange={(e) => update('contextLimit', Number(e.target.value))}
                        />
                      </label>
                      <label>
                        每次输出上限
                        <input
                          type="number"
                          min={128}
                          readOnly={automaticLimits}
                          placeholder="尚未核实"
                          value={limitsKnown ? p.outputLimit : ''}
                          onChange={(e) => update('outputLimit', Number(e.target.value))}
                        />
                      </label>
                      <label>
                        最大输入（tokens）
                        <input
                          type="number"
                          min={1024}
                          readOnly={automaticLimits}
                          placeholder={limitsKnown ? '未单独声明，受总容量与输出共同限制' : '尚未核实'}
                          value={limitsKnown ? (p.inputLimit ?? '') : ''}
                          onChange={(e) =>
                            update('inputLimit', e.target.value === '' ? null : Number(e.target.value))
                          }
                        />
                      </label>
                    </div>
                  </>
                )}
                <div className="button-row">
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={p.stream}
                      onChange={(e) => update('stream', e.target.checked)}
                    />
                    流式输出
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={p.tools}
                      onChange={(e) => update('tools', e.target.checked)}
                    />
                    工具调用
                  </label>
                </div>
                <details>
                  <summary>费用与超时</summary>
                  <div className="form-grid">
                    <label>
                      输入价 / 百万 tokens
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={p.inputPrice ?? ''}
                        onChange={(e) =>
                          update('inputPrice', e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </label>
                    <label>
                      输出价 / 百万 tokens
                      <input
                        type="number"
                        min={0}
                        step="any"
                        value={p.outputPrice ?? ''}
                        onChange={(e) =>
                          update('outputPrice', e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </label>
                    <label>
                      货币
                      <input value={p.currency} onChange={(e) => update('currency', e.target.value)} />
                    </label>
                    <label>
                      超时（秒）
                      <input
                        type="number"
                        value={p.timeoutSeconds}
                        onChange={(e) => update('timeoutSeconds', Number(e.target.value))}
                      />
                    </label>
                    <label>
                      Temperature（留空使用服务端默认）
                      <input
                        type="number"
                        min={0}
                        max={2}
                        step={0.1}
                        value={p.temperature ?? ''}
                        onChange={(e) =>
                          update('temperature', e.target.value === '' ? null : Number(e.target.value))
                        }
                      />
                    </label>
                  </div>
                </details>
              </fieldset>
              {!!unresolvedModels.length && (
                <p className="form-error" role="alert">
                  以下模型尚未核实官方上限：{unresolvedModels.join('、')}
                  。请刷新列表，或在上方切换到对应模型并手动配置。
                </p>
              )}
              <div className="provider-actions">
                <button
                  type="submit"
                  className="primary"
                  disabled={!selected.length || !p.name.trim() || !ready || !!unresolvedModels.length}
                >
                  {working ? '正在处理…' : '保存配置'}
                </button>
                <button
                  type="button"
                  disabled={dirty || !editingModel || p.protocol === 'images'}
                  onClick={() => void testConnection(false)}
                >
                  测试文字
                </button>
                <button
                  type="button"
                  disabled={dirty || !editingModel || p.protocol === 'images' || !p.tools}
                  onClick={() => void testConnection(true)}
                >
                  测试工具续轮
                </button>
              </div>
              <small className="provider-help">
                测试会调用 API，可能产生费用。修改配置后请先保存再测试。
              </small>
              {result && (
                <p className="provider-result" role="status">
                  {result}
                </p>
              )}
              {formError && (
                <p className="catalog-error" role="alert">
                  {formError}
                </p>
              )}
            </fieldset>
          </form>
        </div>
      </section>
    </div>
  );
}
