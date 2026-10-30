import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Profile } from '../shared/types';
import { contextMeter, type ContextUsage, type ContextCompaction } from '../shared/context-meter';
import type { GenerationActivity } from '../shared/generation';
import './context-meter.css';

const number = (value: number) => Math.round(value).toLocaleString();
const bytes = (value: number) => `${(value / 1024).toFixed(1)} KB`;

export function ContextMeter({ profile, usage }: { profile?: Profile; usage?: ContextUsage }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ left: number; top?: number; bottom?: number; maxHeight?: number }>({ left: 0, bottom: 0 });
  const anchor = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const id = useId(), meter = contextMeter(profile, usage);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect();
      if (rect) {
        const above = rect.top > innerHeight - rect.bottom;
        setPosition({ left: Math.max(8, Math.min(rect.right - 310, innerWidth - Math.min(310, innerWidth - 16) - 8)),
          ...(above ? { bottom: innerHeight - rect.top + 8 } : { top: rect.bottom + 8 }),
          maxHeight: Math.max(64, (above ? rect.top : innerHeight - rect.bottom) - 16) });
      }
    };
    const close = (event: Event) => {
      if (!anchor.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); anchor.current?.focus(); } };
    place();
    window.addEventListener('resize', place); window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', close); document.addEventListener('focusin', close); document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', close); document.removeEventListener('focusin', close); document.removeEventListener('keydown', escape);
    };
  }, [open]);
  const percentage = meter.percent === null ? '—' : `${Math.round(meter.percent)}%`;
  const label = `上下文：${meter.label}${meter.percent === null ? '' : `，${percentage}`}`;
  return <>
    <button type="button" className={`context-meter ${meter.percent !== null && meter.percent >= 80 ? 'context-meter-high' : ''}`}
      ref={anchor} aria-label={label} title={label} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}>
      <svg viewBox="0 0 28 28" aria-hidden="true"><circle className="context-meter-track" cx="14" cy="14" r="10" />
        {meter.percent !== null && <circle className="context-meter-fill" cx="14" cy="14" r="10" pathLength="100" strokeDasharray={`${Math.max(0, Math.min(100, meter.percent))} 100`} />}
        {meter.percent === null && <text x="14" y="18" textAnchor="middle">?</text>}
      </svg>
      <span>{meter.measured || meter.percent === null ? '' : '≈'}{percentage}</span>
    </button>
    {open && createPortal(<div className="context-meter-popover" ref={panel} id={id} role="region" aria-label="上下文用量详情" style={position}>
      <strong>上下文用量</strong><p>{profile?.model ?? '尚未选择模型'}</p>
      <dl><dt>{meter.separate ? '模型输入容量' : '模型上下文容量'}</dt><dd>{meter.capacity === null ? '未知' : number(meter.capacity)}</dd>
        <dt>最近请求输入</dt><dd>{meter.tokens === null ? '待测量' : `${meter.measured ? '' : '约 '}${number(meter.tokens)} tokens`}</dd>
        {meter.inputLimit !== null && <><dt>本机输入上限</dt><dd>{number(meter.inputLimit)}</dd></>}
        {meter.availableInput !== null && <><dt>预留后可用输入</dt><dd>{number(meter.availableInput)}</dd></>}
        {profile && <><dt>预留输出上限</dt><dd>{number(profile.outputLimit)}</dd></>}
      </dl>
      <p>{profile?.limitMode === 'official' && meter.capacity !== null ? '容量来自该模型已核实的配置。' : meter.capacity !== null ? '容量来自当前连接的手动配置。' : '请在模型设置中核实容量。'}</p>
      {meter.matching ? <p>{meter.measured ? '输入量由服务端返回，包含缓存输入；缓存命中不会减少上下文占用。' : usage?.method === 'utf8_upper_bound' ? '当前为 UTF-8 字节保守上界，不是服务端实测 token 数。' : usage?.method === 'measured_prefix_upper_bound' ? '已测前缀加未测尾部的保守上界，完整输入尚未实测。' : '当前为本地分词估算。'}{usage?.status === 'unknown' ? '本次请求结果未知。' : usage?.status === 'not_sent' ? '请求未成功执行，显示发送前估算。' : usage?.status === 'complete' && !meter.measured ? '服务端未报告输入用量，本次保留估算值。' : ''}</p> : <p>当前模型尚无本次上下文测量；发送后自动更新。</p>}
    </div>, document.querySelector('.client-module') ?? document.body)}
  </>;
}

export function ContextCompactions({ items, activity, running }: { items?: ContextCompaction[]; activity?: GenerationActivity; running?: boolean }) {
  return <>
    {running && activity?.phase === 'compacting' && <p className="context-compaction" role="status">正在整理上下文…</p>}
    {items?.map(item => <details className="context-compaction" key={item.id}>
      <summary>{item.kind === 'stage_handoff' ? '上下文已压缩 · 保留当前完整资料' : '较早对话已整理 · 原消息可回查'}</summary>
      <p>{item.kind === 'stage_handoff' ? `移出已完成阶段的执行历史，保留 ${item.retainedSources ?? 0} 份必需资料、作者要求与当前工具记录。` : `将 ${item.archivedMessages ?? 0} 条较早消息改为可回查索引摘录；不视为已采纳设定，原消息仍可检索。`}</p>
      <p>文本大小 {bytes(item.beforeBytes)} → {bytes(item.afterBytes)} · 本地整理 {number(item.elapsedMs)} 毫秒 · 未增加模型请求</p>
    </details>)}
  </>;
}
