import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent
} from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, ChevronRight, RotateCcw, Search, Zap } from 'lucide-react';
import type { Profile } from '../shared/types';
import { invokeCommand } from '../shared/client';
import {
  effortDescriptions,
  effortLabels,
  reasoningCapability,
  reasoningLabel,
  type ReasoningSelection
} from '../shared/reasoning';
import { modelLabel } from './model-label';
import './model-control.css';

export function ReasoningSlider({
  profile,
  value,
  onChange,
  onCommit,
  disabled = false,
  modelAction,
  note
}: {
  profile: Profile;
  value: ReasoningSelection;
  onChange: (value: ReasoningSelection) => void;
  onCommit?: (value: ReasoningSelection) => void;
  disabled?: boolean;
  modelAction?: () => void;
  note?: string;
}) {
  const uid = useId(),
    capability = reasoningCapability(profile);
  const values: ReasoningSelection[] = [null, ...(capability?.efforts ?? [])];
  const index = Math.max(0, values.indexOf(value));
  const label = reasoningLabel(value);
  const describe = value
    ? effortDescriptions[value]
    : capability
      ? '由模型服务决定推理强度。'
      : '此模型的可调档位尚未接入，使用服务端默认。';
  return (
    <div className="reasoning-card">
      <div className="reasoning-card-heading">
        <Zap size={16} aria-hidden="true" />
        <strong aria-live="polite">
          {label}
          {value && value !== 'max' && (
            <small>{value === 'xhigh' ? 'Extra high' : value[0].toUpperCase() + value.slice(1)}</small>
          )}
        </strong>
        <button
          type="button"
          className="reasoning-reset"
          title="恢复默认推理强度"
          aria-label="恢复默认推理强度"
          disabled={disabled || value === null}
          onClick={() => {
            onChange(null);
            onCommit?.(null);
          }}
        >
          <RotateCcw size={15} />
        </button>
      </div>
      {modelAction ? (
        <button
          type="button"
          className="reasoning-model-name"
          disabled={disabled}
          onClick={modelAction}
          title="切换模型"
          aria-label={`切换模型，当前 ${profile.model}`}
        >
          {profile.model}
          <ChevronRight size={12} aria-hidden="true" />
        </button>
      ) : (
        <div className="reasoning-model-name">{profile.model}</div>
      )}
      {capability && (
        <>
          <div
            className="reasoning-track"
            style={{ '--effort-progress': `${(index / (values.length - 1)) * 100}%` } as CSSProperties}
          >
            <div className="reasoning-track-fill" aria-hidden="true" />
            <div className="reasoning-ticks" aria-hidden="true">
              {values.map((effort, i) => (
                <i key={effort ?? 'auto'} className={i <= index ? 'filled' : ''} />
              ))}
            </div>
            <input
              type="range"
              min={0}
              max={values.length - 1}
              step={1}
              value={index}
              disabled={disabled}
              aria-label={`${profile.model} 推理强度`}
              aria-valuetext={label}
              aria-describedby={`${uid}-description`}
              onChange={(event) => onChange(values[Number(event.currentTarget.value)])}
              onPointerUp={(event) => onCommit?.(values[Number(event.currentTarget.value)])}
              onKeyUp={(event) => {
                if (
                  [
                    'ArrowLeft',
                    'ArrowRight',
                    'ArrowUp',
                    'ArrowDown',
                    'Home',
                    'End',
                    'PageUp',
                    'PageDown'
                  ].includes(event.key)
                )
                  onCommit?.(values[Number(event.currentTarget.value)]);
              }}
              onBlur={(event) => onCommit?.(values[Number(event.currentTarget.value)])}
            />
          </div>
          <div className="reasoning-scale" aria-hidden="true">
            <span>默认</span>
            <span>{effortLabels[capability.efforts[0]]}</span>
            <span>{effortLabels[capability.efforts.at(-1)!]}</span>
          </div>
        </>
      )}
      <p className="reasoning-description" id={`${uid}-description`}>
        {describe}
      </p>
      {note && <p className="reasoning-note">{note}</p>}
    </div>
  );
}

export function ModelControl({
  profiles,
  profileId,
  onProfileChange,
  disabled = false,
  onPendingChange,
  label = '选择模型与推理强度'
}: {
  profiles: Profile[];
  profileId: string;
  onProfileChange: (id: string) => void;
  disabled?: boolean;
  onPendingChange?: (pending: boolean) => void;
  label?: string;
}) {
  const uid = useId(),
    trigger = useRef<HTMLButtonElement>(null),
    popup = useRef<HTMLDivElement>(null),
    search = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false),
    [modelsOpen, setModelsOpen] = useState(false),
    [query, setQuery] = useState('');
  const [position, setPosition] = useState<CSSProperties>({}),
    [local, setLocal] = useState<Profile>();
  const [draft, setDraft] = useState<ReasoningSelection>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const savingRef = useRef(false);
  const available = profiles.filter((p) => p.protocol !== 'images' && p.enabled !== false);
  const supplied = available.find((p) => p.id === profileId);
  const profile =
    local &&
    supplied &&
    local.id === supplied.id &&
    local.version === supplied.version &&
    (local.reasoningRevision ?? 0) >= (supplied.reasoningRevision ?? 0)
      ? local
      : supplied;
  const visible = available.filter((p) =>
    `${p.model} ${p.name} ${p.protocol}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  useEffect(() => {
    setDraft(profile?.reasoningEffort ?? null);
    setError('');
  }, [profile?.id, profile?.version, profile?.reasoningRevision, profile?.reasoningEffort]);
  useEffect(() => {
    if (modelsOpen) search.current?.focus();
  }, [modelsOpen]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const box = trigger.current!.getBoundingClientRect(),
        width = Math.min(304, innerWidth - 24);
      const above = box.top > innerHeight - box.bottom;
      setPosition({
        width,
        left: Math.max(12, Math.min(box.left, innerWidth - width - 12)),
        ...(above ? { bottom: innerHeight - box.top + 8 } : { top: box.bottom + 8 }),
        maxHeight: Math.max(90, (above ? box.top : innerHeight - box.bottom) - 20)
      });
    };
    place();
    const outside = (event: Event) => {
      if (!popup.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node))
        setOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    (popup.current?.querySelector<HTMLInputElement>('input[type=range]') ?? search.current)?.focus();
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  async function save(value: ReasoningSelection) {
    if (!profile || savingRef.current || disabled || value === (profile.reasoningEffort ?? null)) return;
    savingRef.current = true;
    setSaving(true);
    onPendingChange?.(true);
    setError('');
    try {
      const saved = await invokeCommand('profiles.reasoning', {
        id: profile.id,
        effort: value,
        expectedVersion: profile.version,
        expectedRevision: profile.reasoningRevision ?? 0
      });
      setLocal(saved);
    } catch (cause) {
      setDraft(profile.reasoningEffort ?? null);
      setError((cause as Error).message);
    } finally {
      savingRef.current = false;
      setSaving(false);
      onPendingChange?.(false);
    }
  }
  function navigate(event: KeyboardEvent) {
    if (event.nativeEvent.isComposing || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const options = [...(popup.current?.querySelectorAll<HTMLButtonElement>('[role=option]') ?? [])];
    const index = options.indexOf(document.activeElement as HTMLButtonElement);
    if (!options.length || (index < 0 && !['ArrowDown', 'ArrowUp'].includes(event.key))) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : event.key === 'ArrowDown'
            ? (index + 1) % options.length
            : index < 0
              ? options.length - 1
              : (index - 1 + options.length) % options.length;
    options[next]?.focus();
  }
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="model-control-trigger"
        disabled={disabled || saving}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `${uid}-panel` : undefined}
        title={
          profile
            ? `${modelLabel(profile, available)} · 推理强度：${reasoningLabel(profile.reasoningEffort)}`
            : '选择模型'
        }
        onClick={() => {
          setOpen(!open);
          setModelsOpen(!profile);
          setQuery('');
        }}
      >
        <Zap size={14} aria-hidden="true" />
        <span className="model-control-current">{profile?.model ?? '选择模型'}</span>
        {profile && <span className="model-control-effort">{reasoningLabel(profile.reasoningEffort)}</span>}
        <ChevronDown size={12} aria-hidden="true" />
      </button>
      {open &&
        createPortal(
          <div
            ref={popup}
            className="model-control-popover"
            id={`${uid}-panel`}
            role="dialog"
            aria-label="模型与推理强度"
            style={position}
          >
            {profile && (
              <ReasoningSlider
                profile={profile}
                value={draft}
                onChange={setDraft}
                onCommit={(value) => void save(value)}
                disabled={disabled || saving}
                modelAction={() => setModelsOpen(!modelsOpen)}
                note={saving ? '正在保存…' : '用于该模型的新消息和新任务；已有任务保留原强度。'}
              />
            )}
            {error && (
              <p className="model-control-error" role="alert">
                {error}
              </p>
            )}
            {modelsOpen && (
              <div className="model-control-models">
                <label className="model-control-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    ref={search}
                    aria-label="搜索模型"
                    placeholder="搜索模型或供应商"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={navigate}
                  />
                </label>
                <div role="listbox" aria-label="可用模型" onKeyDown={navigate}>
                  {visible.map((p) => (
                    <button
                      type="button"
                      key={p.id}
                      className="model-control-option"
                      role="option"
                      aria-selected={profileId === p.id}
                      disabled={saving}
                      onClick={() => {
                        onProfileChange(p.id);
                        setLocal(undefined);
                        setModelsOpen(false);
                        setQuery('');
                      }}
                    >
                      <span>
                        <b>{p.model}</b>
                        <small>
                          {p.name} · {p.protocol}
                        </small>
                      </span>
                      {profileId === p.id && <Check size={15} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
                {!visible.length && (
                  <p className="reasoning-description">
                    {available.length ? '没有匹配的模型' : '请先在模型设置中启用文字模型。'}
                  </p>
                )}
              </div>
            )}
          </div>,
          trigger.current?.closest('.client-module') ?? document.body
        )}
    </>
  );
}
