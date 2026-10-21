import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUp,
  Square,
  Plus,
  Globe,
  ListChecks,
  Feather,
  FilePenLine,
  MessagesSquare,
  X
} from 'lucide-react';
import type { Profile } from '../shared/types';
import type { Conversation } from '../shared/assistant';
import { ModelControl } from './ModelControl';
import { sendOnEnter } from './composer-keyboard';

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
  const [menu, setMenu] = useState<'tools' | null>(null);
  const [modelPending, setModelPending] = useState(false);
  const [position, setPosition] = useState({ left: 0, bottom: 0, width: 320, maxHeight: 360 });
  const textarea = useRef<HTMLTextAreaElement>(null);
  const toolsButton = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const uid = useId();
  const otherChats = props.conversations.filter((c) => c.id !== props.conversationId);
  const references = otherChats.filter((c) => props.referenceChats.includes(c.id));

  useEffect(() => {
    setMenu(null);
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
    const anchor = toolsButton.current;
    if (!anchor) return;
    const place = () => {
      const box = anchor.getBoundingClientRect();
      const width = Math.min(320, innerWidth - 24);
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
    popup.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: Event) => {
      const node = event.target as Node;
      if (!popup.current?.contains(node) && !toolsButton.current?.contains(node)) setMenu(null);
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

  function toggle(next: 'tools') {
    setMenu(menu === next ? null : next);
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
          rows={2}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => sendOnEnter(event, props.canSend && !modelPending, props.onSend)}
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
            <ModelControl
              profiles={props.profiles}
              profileId={props.profileId}
              onProfileChange={props.onProfileChange}
              onPendingChange={setModelPending}
              label="聊天模型与推理强度"
            />
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
              title="发送消息 · Enter"
              disabled={!props.canSend || modelPending}
              onClick={props.onSend}
            >
              <ArrowUp size={19} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <div className="sr-only" id={`${uid}-hint`}>
        Enter 发送，Shift+Enter 换行
      </div>
      {menu &&
        createPortal(
          <div ref={popup} className="chat-composer-popover" style={position}>
            <div role="dialog" aria-label="创作工具与引用其他聊天" id={`${uid}-tools`}>
              <div className="chat-composer-menu-heading">
                创作工具<small>先提出任务卡，确认后开始</small>
              </div>
              <div className="chat-composer-task-tools">
                <button disabled={!props.canPropose || modelPending} onClick={() => propose('stage')}>
                  <ListChecks size={16} />
                  提出当前阶段任务
                </button>
                <button disabled={!props.canPropose || modelPending} onClick={() => propose('draft')}>
                  <Feather size={16} />
                  按输入提出自由试写
                </button>
                <button disabled={!props.canPropose || modelPending} onClick={() => propose('revision')}>
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
          </div>,
          document.querySelector('.client-module') ?? document.body
        )}
    </>
  );
}
