import { webSourceUrl, type NativeWebSearchState } from '../shared/web-search';

export function WebSearchEvidence({ state, running = false }: { state?: NativeWebSearchState; running?: boolean }) {
  if (!state?.calls.length) return null;
  const active = state.calls.some(call => !['completed', 'failed'].includes(call.status));
  const failed = state.calls.some(call => call.status === 'failed');
  const sources = [...new Map([...state.calls.flatMap(call => call.sources), ...state.citations]
    .filter(source => webSourceUrl(source.url)).map(source => [source.url, source])).values()];
  return <div aria-label="OpenAI 联网搜索记录">
    <p role="status">{active ? running ? '正在联网搜索…' : '联网搜索结果未完整确认' : failed ? '部分联网搜索未完成' : '联网搜索完成'} · {state.calls.length} 次工具调用</p>
    {!active && !sources.length && <p className="inline-warning">原生搜索未返回可核对来源。</p>}
    {sources.length > 0 && <details>
      <summary>联网来源 · {sources.length}</summary>
      {sources.map(source => <div className="chat-source" key={source.url}>
        <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>
      </div>)}
    </details>}
  </div>;
}
