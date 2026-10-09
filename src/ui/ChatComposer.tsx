import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUp,
  Square,
  Plus,
  ChevronDown,
  Check,
  Globe,
  Search,
  ListChecks,
  Feather,
  FilePenLine,
  MessagesSquare,
  X
} from 'lucide-react';
import type { Profile } from '../shared/types';
import type { Conversation } from '../shared/assistant';
import { modelLabel } from './model-label';

interface Props {
  conversationId: string;
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  profiles: Profile[];
  profileId: string;
  onProfileChange: (id: string) => void;
  online: boolean;
  onOnlineChange: (online: boolean) => void;
  onlineDisabled: boolean;
  canSend: boolean;
  canPropose: boolean;
  running: boolean;
  conversations: Conversation[];
  referenceChats: string[];
  onReferencesChange: (ids: string[]) => void;
  onPropose: (kind: 'stage' | 'draft' | 'revision') => void;
}

export function ChatComposer(props: Props) {
  const [menu, setMenu] = useState<'tools' | 'models' | null>(null);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState({ left: 0, bottom: 0, width: 320, maxHeight: 360 });
  const textarea = useRef<HTMLTextAreaElement>(null);
  const toolsButton = useRef<HTMLButtonElement>(null);
  const modelButton = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const modelSearch = useRef<HTMLInputElement>(null);
  const uid = useId();
  const textProfiles = props.profiles.filter((p) => p.protocol !== 'images');
  const selectedModel = textProfiles.find((p) => p.id === props.profileId);
  const visibleModels = textProfiles.filter((p) =>
    `${p.model} ${p.name} ${p.protocol}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  );
  const otherChats = props.conversations.filter((c) => c.id !== props.conversationId);
  const references = otherChats.filter((c) => props.referenceChats.includes(c.id));

  useEffect(() => {
    setMenu(null);
    setQuery('');
  }, [props.conversationId]);
  useLayoutEffect(() => {
    const element = textarea.current;
    if (!element) return;
    const fit = () => {
      element.style.height = 'auto';
      element.style.height = `${Math.min(element.scrollHeight, Math.max(58, Math.min(220, innerHeight * 0.25)))}px`;
    };
    fit();
    let width = element.clientWidth;
    const observer = new ResizeObserver(() => {
      if (element.clientWidth !== width) {
        width = element.clientWidth;
        fit();
      }
    });
    observer.observe(element);
    window.addEventListener('resize', fit);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [props.value, props.conversationId]);

  useLayoutEffect(() => {
    if (!menu) return;
    const anchor = menu === 'tools' ? toolsButton.current : modelButton.current;
    if (!anchor) return;
    const place = () => {
      const box = anchor.getBoundingClientRect();
      const width = Math.min(menu === 'models' ? 330 : 320, innerWidth - 24);
      setPosition({
        left: Math.max(12, Math.min(box.left, innerWidth - width - 12)),
        bottom: innerHeight - box.top + 8,
        width,
        maxHeight: Math.max(80, Math.min(390, box.top - 20))
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    const observer = new ResizeObserver(place);
    if (textarea.current) observer.observe(textarea.current);
    if (menu === 'models') modelSearch.current?.focus();
    else popup.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: Event) => {
      const node = event.target as Node;
      if (
        !popup.current?.contains(node) &&
        !toolsButton.current?.contains(node) &&
        !modelButton.current?.contains(node)
      )
        setMenu(null);
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setMenu(null);
      anchor.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    document.addEventListener('keydown', escape);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      observer.disconnect();
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [menu]);

  function toggle(next: 'tools' | 'models') {
    setQuery('');
    setMenu(menu === next ? null : next);
  }
  function navigateModels(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    const options = Array.from(popup.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? []);
    const at = options.findIndex((option) => option === document.activeElement);
    if (!options.length || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (at < 0 && !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : event.key === 'ArrowDown'
            ? (at + 1) % options.length
            : at < 0
              ? options.length - 1
              : (at - 1 + options.length) % options.length;
    options[next]?.focus();
  }
  function propose(kind: 'stage' | 'draft' | 'revision') {
    setMenu(null);
    textarea.current?.focus();
    props.onPropose(kind);
  }

  return (
    <>
      <div className="composer chat-composer">
        {references.length > 0 && (
          <div className="chat-composer-references" aria-label="本轮引用的聊天">
            {references.map((c) => (
              <button
                key={c.id}
                title={`取消引用：${c.title}`}
                aria-label={`取消引用：${c.title}`}
                onClick={() => props.onReferencesChange(props.referenceChats.filter((id) => id !== c.id))}
              >
                <MessagesSquare size={13} aria-hidden="true" />
                <span>{c.title}</span>
                <X size={12} aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={textarea}
          aria-label="聊天消息"
          aria-describedby={`${uid}-hint`}
          placeholder="聊聊你的故事，或提出创作问题…"
          rows={2}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (!event.nativeEvent.isComposing && (event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              if (props.canSend) props.onSend();
            }
          }}
        />
        <div className="chat-composer-toolbar">
          <div className="chat-composer-controls">
            <button
              ref={toolsButton}
              className="chat-composer-add"
              aria-label="创作工具与引用其他聊天"
              title="创作工具与引用其他聊天"
              aria-haspopup="dialog"
              aria-expanded={menu === 'tools'}
              aria-controls={menu === 'tools' ? `${uid}-tools` : undefined}
              onClick={() => toggle('tools')}
            >
              <Plus size={19} strokeWidth={1.7} aria-hidden="true" />
            </button>
            <button
              ref={modelButton}
              className="chat-composer-model"
              aria-label="聊天模型"
              title={selectedModel ? modelLabel(selectedModel, textProfiles) : '选择模型'}
              aria-haspopup="listbox"
              aria-expanded={menu === 'models'}
              aria-controls={menu === 'models' ? `${uid}-models` : undefined}
              onClick={() => toggle('models')}
            >
              <span>{selectedModel ? modelLabel(selectedModel, textProfiles) : '选择模型'}</span>
              <ChevronDown size={13} aria-hidden="true" />
            </button>
            <button
              className="chat-composer-online"
              aria-label="按需联网"
              aria-pressed={props.online}
              title={props.online ? '按需联网已开启，点击关闭' : '联网已关闭，点击开启'}
              disabled={props.onlineDisabled}
              onClick={() => props.onOnlineChange(!props.online)}
            >
              <Globe size={15} strokeWidth={1.7} aria-hidden="true" />
              <span>{props.online ? '按需联网' : '联网已关'}</span>
              <span className="chat-online-indicator" aria-hidden="true" />
            </button>
          </div>
          {props.running ? (
            <button
              className="chat-composer-submit"
              aria-label="停止聊天"
              title="停止聊天"
              onClick={props.onStop}
            >
              <Square size={12} fill="currentColor" strokeWidth={0} aria-hidden="true" />
            </button>
          ) : (
            <button
              className="chat-composer-submit"
              aria-label="发送消息"
              title="发送消息 · Ctrl + Enter"
              disabled={!props.canSend}
              onClick={props.onSend}
            >
              <ArrowUp size={19} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="sr-only" id={`${uid}-hint`}>
        Ctrl + Enter 发送
      </div>
      {menu &&
        createPortal(
          <div ref={popup} className="chat-composer-popover" style={position}>
            {menu === 'tools' ? (
              <div role="dialog" aria-label="创作工具与引用其他聊天" id={`${uid}-tools`}>
                <div className="chat-composer-menu-heading">
                  创作工具<small>先提出任务卡，确认后开始</small>
                </div>
                <div className="chat-composer-task-tools">
                  <button disabled={!props.canPropose} onClick={() => propose('stage')}>
                    <ListChecks size={16} />
                    提出当前阶段任务
                  </button>
                  <button disabled={!props.canPropose} onClick={() => propose('draft')}>
                    <Feather size={16} />
                    按输入提出自由试写
                  </button>
                  <button disabled={!props.canPropose} onClick={() => propose('revision')}>
                    <FilePenLine size={16} />
                    按输入提出正式修订
                  </button>
                </div>
                <div className="chat-composer-menu-heading chat-composer-menu-divider">
                  引用其他聊天<small>仅供本轮参考，不视为已采纳设定</small>
                </div>
                {otherChats.length ? (
                  otherChats.map((c) => (
                    <label className="chat-composer-chat-option" key={c.id}>
                      <input
                        type="checkbox"
                        checked={props.referenceChats.includes(c.id)}
                        onChange={(event) =>
                          props.onReferencesChange(
                            event.target.checked
                              ? [...props.referenceChats, c.id]
                              : props.referenceChats.filter((id) => id !== c.id)
                          )
                        }
                      />
                      <span>
                        {c.title}
                        {c.archived && <small> · 已归档</small>}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="chat-composer-menu-empty">创建其他主题聊天后，可在这里引用。</p>
                )}
              </div>
            ) : (
              <>
                <label className="chat-composer-model-search">
                  <Search size={15} aria-hidden="true" />
                  <input
                    ref={modelSearch}
                    aria-label="搜索聊天模型"
                    placeholder="搜索模型或供应商"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={navigateModels}
                  />
                </label>
                <div role="listbox" aria-label="聊天模型" id={`${uid}-models`} onKeyDown={navigateModels}>
                  {visibleModels.map((profile) => (
                    <button
                      className="chat-composer-model-option"
                      key={profile.id}
                      role="option"
                      aria-label={modelLabel(profile, textProfiles)}
                      aria-selected={profile.id === props.profileId}
                      onClick={() => {
                        props.onProfileChange(profile.id);
                        setMenu(null);
                        modelButton.current?.focus();
                      }}
                    >
                      <span>
                        <b>{profile.model}</b>
                        <small>
                          {profile.name} · {profile.protocol}
                        </small>
                      </span>
                      {profile.id === props.profileId && <Check size={16} aria-hidden="true" />}
                    </button>
                  ))}
                </div>
                {!visibleModels.length && (
                  <p className="chat-composer-menu-empty">
                    {textProfiles.length ? '没有匹配的模型' : '请先在「模型与连接」中启用文字模型。'}
                  </p>
                )}
              </>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
