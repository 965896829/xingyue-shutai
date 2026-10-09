import { useEffect, useState } from 'react';
import type { RoleRule, SearchSettings } from '../shared/assistant';
import type { Command } from '../shared/types';

type Settings = { roles: RoleRule[]; search: SearchSettings; hasKey: boolean };
export function AssistantSettings({ onClose }: { onClose: () => void }) {
  const [data, setData] = useState<Settings>(),
    [selected, select] = useState('editor'),
    [text, setText] = useState(''),
    [key, setKey] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [version, setVersion] = useState('');
  const role = data?.roles.find((r) => r.id === selected);
  async function call(command: Command, args: Record<string, unknown> = {}) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await window.wenxu!.invoke<any>(command, args);
      if (command !== 'search.test') setData(result);
      else
        setNotice(
          `连接成功：取得 ${result.results.length} 条公开结果${result.results.length ? '' : '，服务可达但本次无可用结果'}。`
        );
      return result;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void call('assistant.settings');
  }, []);
  useEffect(() => {
    setText(role?.current.text ?? '');
    setVersion(role?.current.id ?? '');
  }, [selected, role?.current.id]);
  return (
    <div className="scrim">
      <section
        className="modal wide assistant-settings"
        role="dialog"
        aria-modal="true"
        aria-label="智能体与联网设置"
      >
        <header>
          <div>
            <h2>智能体与联网设置</h2>
            <p>一个助手，按问题调用专业规则；正式执行仍须确认。</p>
          </div>
          <button onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="editor-tabs">
          {data?.roles.map((r) => (
            <button key={r.id} className={selected === r.id ? 'active' : ''} onClick={() => select(r.id)}>
              {r.title}
            </button>
          ))}
          <button className={selected === 'search' ? 'active' : ''} onClick={() => select('search')}>
            联网搜索
          </button>
        </div>
        {error && (
          <p role="alert" className="inline-warning">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {role ? (
          <div className="assistant-settings-body">
            <p>{role.summary}</p>
            <label>
              角色规则
              <textarea
                aria-label="角色规则"
                rows={15}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <small>版本：{role.current.id}。规则仅影响回答方法，不能更改批准和文件保护权限。</small>
            <div className="button-row">
              <button
                className="primary"
                disabled={busy || !text.trim()}
                onClick={() => void call('assistant.role.save', { id: role.id, text })}
              >
                保存角色规则
              </button>
              <button disabled={busy} onClick={() => void call('assistant.role.reset', { id: role.id })}>
                恢复默认
              </button>
            </div>
            <label>
              历史版本
              <select aria-label="角色历史版本" value={version} onChange={(e) => setVersion(e.target.value)}>
                {[...role.history].reverse().map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.at} · {v.reason}
                  </option>
                ))}
              </select>
            </label>
            <button
              disabled={busy || !version}
              onClick={() => void call('assistant.role.rollback', { id: role.id, version })}
            >
              回退到所选版本
            </button>
          </div>
        ) : data && selected === 'search' ? (
          <div className="assistant-settings-body">
            <p>Tavily Search / Extract 兼容服务。查询词、来源及时间保存在当前回答的执行记录中。</p>
            <label>
              接口根地址
              <input
                aria-label="搜索接口根地址"
                value={data.search.baseUrl}
                onChange={(e) => setData({ ...data, search: { ...data.search, baseUrl: e.target.value } })}
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                autoComplete="off"
                aria-label="搜索 API Key"
                placeholder={data.hasKey ? '已加密保存；留空保留原 Key' : '填写搜索服务 Key'}
                value={key}
                onChange={(e) => setKey(e.target.value)}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={data.search.enabled}
                onChange={(e) => setData({ ...data, search: { ...data.search, enabled: e.target.checked } })}
              />
              允许按需联网（聊天中仍可关闭）
            </label>
            <div className="search-limits">
              {(
                [
                  ['maxResults', '每次搜索最多结果'],
                  ['maxSearches', '每轮最多搜索次数'],
                  ['maxExtracts', '每轮最多提取网页'],
                  ['timeoutSeconds', '超时秒数']
                ] as const
              ).map(([name, label]) => (
                <label key={name}>
                  {label}
                  <input
                    type="number"
                    aria-label={label}
                    value={data.search[name]}
                    onChange={(e) =>
                      setData({ ...data, search: { ...data.search, [name]: Number(e.target.value) } })
                    }
                  />
                </label>
              ))}
            </div>
            <div className="button-row">
              <button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  const result = await call('search.settings.save', { search: data.search, apiKey: key });
                  if (result) {
                    setKey('');
                    setNotice('联网设置已保存');
                  }
                }}
              >
                保存联网设置
              </button>
              <button disabled={busy || !data.hasKey} onClick={() => void call('search.test')}>
                测试已保存的连接
              </button>
              <button
                disabled={busy || !data.hasKey}
                onClick={() => void call('search.settings.save', { search: data.search, clearKey: true })}
              >
                清除 Key
              </button>
            </div>
            <small>测试会发起一次公开搜索请求，可能消耗服务商额度。关闭联网不影响本地资料读取。</small>
          </div>
        ) : (
          <p>正在读取设置…</p>
        )}
      </section>
    </div>
  );
}
