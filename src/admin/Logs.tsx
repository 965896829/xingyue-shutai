import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { invokeCommand } from '../shared/client';
import type { Snapshot, RunEvent, Run } from '../shared/types';
import type { ManagementLog, ManagementLogPage } from '../shared/management';
import type { ManagementTransport } from './transport';
import { useToast } from './reference/components/ui';
const time = (value?: string) => (value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—');
const runLabels: Record<string, string> = {
  running: '执行中',
  awaiting_review: '待审核',
  awaiting_input: '待回答',
  awaiting_permission: '待授权',
  needs_repair: '待调整',
  paused: '已暂停',
  unknown: '结果未知',
  failed: '失败',
  complete: '已采纳',
  discarded: '已放弃',
  stale: '待核对',
  committing: '提交中'
};
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function Logs({
  transport,
  snapshot,
  fail: failProp
}: {
  transport: ManagementTransport;
  snapshot?: Snapshot;
  fail?(error: string): void;
}) {
  const toast = useToast();
  const fail = failProp ?? ((message: string) => toast(message, true));
  const [tab, setTab] = useState<'operations' | 'tasks'>('operations');
  const [items, setItems] = useState<ManagementLog[]>([]);
  const [before, setBefore] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [runId, setRunId] = useState('');
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [moreEvents, setMoreEvents] = useState(false);
  const [tasks, setTasks] = useState<Run[]>([]);
  const [taskCursor, setTaskCursor] = useState<{ before: number | null; watermark: number }>();
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);
  const taskSequence = useRef(0);
  const scope = snapshot?.project ? `${snapshot.project.id}:${snapshot.project.root}` : undefined;
  const load = useCallback(
    async (older?: number) => {
      const seq = ++sequence.current;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          limit: '100',
          ...(query ? { query } : {}),
          ...(status ? { status } : {}),
          ...(older ? { before: String(older) } : {})
        });
        const result = await transport.api<ManagementLogPage>('logs?' + params);
        if (seq !== sequence.current) return;
        setItems((current) => (older ? [...current, ...result.items] : result.items));
        setBefore(result.nextBefore);
      } catch (e) {
        fail((e as Error).message);
      } finally {
        if (seq === sequence.current) setLoading(false);
      }
    },
    [query, status, transport]
  );
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load, scope]);
  async function taskEvents(id: string, afterSeq = 0) {
    const seq = ++sequence.current;
    setLoading(true);
    try {
      const result = await invokeCommand('run.events', { id, afterSeq, limit: 200 });
      if (sequence.current !== seq) return;
      setEvents((current) =>
        afterSeq
          ? [...current, ...result.filter((event) => !current.some((old) => old.seq === event.seq))]
          : result
      );
      setMoreEvents(result.length === 200);
    } catch (e) {
      fail((e as Error).message);
    } finally {
      if (seq === sequence.current) setLoading(false);
    }
  }
  async function loadTasks(older = false) {
    const seq = ++taskSequence.current;
    try {
      const result = await invokeCommand('run.page', {
        limit: 100,
        ...(older && taskCursor?.before ? { before: taskCursor.before, watermark: taskCursor.watermark } : {})
      });
      if (seq !== taskSequence.current) return;
      setTasks((current) => (older ? [...current, ...result.items] : result.items));
      setTaskCursor({ before: result.nextBefore, watermark: result.watermark });
    } catch (e) {
      fail((e as Error).message);
    }
  }
  useEffect(() => {
    sequence.current++;
    taskSequence.current++;
    setRunId('');
    setEvents([]);
    setMoreEvents(false);
    setTasks([]);
    setTaskCursor(undefined);
  }, [scope]);
  useEffect(() => {
    if (tab === 'tasks' && scope) void loadTasks();
  }, [tab, scope]);
  useEffect(() => {
    if (tab !== 'tasks' || !runId) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = window.wenxu!.onEvent((event) => {
      if (event.type !== 'run-event' || (event.runId && event.runId !== runId) || timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        void taskEvents(runId, events.at(-1)?.seq ?? 0);
      }, 500);
    });
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [tab, runId, events]);
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <p>OBSERVABILITY</p>
          <h1>运行日志</h1>
          <span>管理操作记录覆盖桌面和网页；任务事件来自当前作品的持久化日志。</span>
        </div>
        <button
          onClick={() =>
            download(
              `星月书台-${tab === 'operations' ? '管理操作' : '任务事件'}.json`,
              JSON.stringify(tab === 'operations' ? items : events, null, 2)
            )
          }
        >
          <Download size={16} />
          导出已载入记录
        </button>
      </div>
      <section className="admin-card">
        <div className="admin-tabs">
          <button className={tab === 'operations' ? 'active' : ''} onClick={() => setTab('operations')}>
            管理操作
          </button>
          <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>
            任务事件
          </button>
        </div>
        {tab === 'operations' ? (
          <>
            <div className="admin-log-filters">
              <input
                aria-label="筛选操作日志"
                placeholder="命令或操作编号"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select aria-label="日志状态" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">全部状态</option>
                <option value="ok">成功</option>
                <option value="error">失败</option>
              </select>
              <button disabled={loading} onClick={() => void load()}>
                <RefreshCw size={15} />
                刷新
              </button>
            </div>
            <div className="admin-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>时间</th>
                    <th>来源</th>
                    <th>操作命令</th>
                    <th>状态</th>
                    <th>耗时</th>
                    <th>操作编号 / 错误码</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.seq}>
                      <td>{time(item.at)}</td>
                      <td>
                        {item.source === 'browser' ? '网页' : item.source === 'desktop' ? '桌面' : '系统'}
                      </td>
                      <td>
                        <code>{item.command}</code>
                      </td>
                      <td>
                        <span className={`admin-badge ${item.status === 'error' ? 'bad' : ''}`}>
                          {item.status === 'ok' ? '成功' : '失败'}
                        </span>
                      </td>
                      <td>{item.durationMs} ms</td>
                      <td>
                        <code>{item.errorCode ?? item.operationId ?? '—'}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!items.length && <div className="admin-empty">暂无匹配的操作记录</div>}
            {before && (
              <button className="admin-load-more" disabled={loading} onClick={() => void load(before)}>
                加载更早记录
              </button>
            )}
            <p className="admin-note">
              记录从升级后开始积累，最多保留约 20,000 条。只读刷新不重复记账。导出仅包含当前已载入记录。
            </p>
          </>
        ) : (
          <>
            <div className="admin-log-filters">
              <select
                aria-label="选择任务日志"
                value={runId}
                onChange={(e) => {
                  setRunId(e.target.value);
                  setEvents([]);
                  if (e.target.value) void taskEvents(e.target.value);
                }}
              >
                <option value="">选择当前作品的任务</option>
                {tasks.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.stage} · {runLabels[run.status] ?? run.status} · {run.id.slice(0, 8)}
                  </option>
                ))}
              </select>
              <button disabled={!runId || loading} onClick={() => void taskEvents(runId)}>
                <RefreshCw size={15} />
                刷新任务事件
              </button>
            </div>
            {taskCursor?.before && (
              <button disabled={loading} onClick={() => void loadTasks(true)}>
                加载更早任务
              </button>
            )}
            <div className="admin-event-list">
              {events.map((event, index) => (
                <details key={event.seq ?? index}>
                  <summary>
                    <code>#{event.seq}</code>
                    <b>{event.kind}</b>
                    <span>{time(event.at)}</span>
                  </summary>
                  <pre>{JSON.stringify(event, null, 2)}</pre>
                </details>
              ))}
            </div>
            {!events.length && <div className="admin-empty">选择任务查看请求、审核和执行事件。</div>}
            {moreEvents && (
              <button disabled={loading} onClick={() => void taskEvents(runId, events.at(-1)?.seq ?? 0)}>
                加载后续事件
              </button>
            )}
          </>
        )}
      </section>
    </>
  );
}
