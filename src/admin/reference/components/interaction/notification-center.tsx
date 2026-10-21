"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post, formatTime } from "@reference/lib/api";
import { Drawer, Empty, ErrorState, Spinner, useToast } from "../ui";
import { NotificationBell } from "./notification-bell";

type Inbox = {
  items: {
    id: string;
    name: string;
    status: string;
    created_at: string;
    data: { body?: string };
  }[];
  total: number;
  unread_count: number;
};
const PAGE_SIZE = 30;

export function NotificationCenter({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false),
    [unread, setUnread] = useState(false),
    [offset, setOffset] = useState(0),
    [busy, setBusy] = useState(false);
  const cache = useQueryClient(),
    toast = useToast();
  const summary = useQuery<Inbox>({
    queryKey: ["notifications", userId, "summary"],
    queryFn: () => api("/notifications?limit=1"),
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const inbox = useQuery<Inbox>({
    queryKey: ["notifications", userId, unread, offset],
    queryFn: () =>
      api(
        `/notifications?limit=${PAGE_SIZE}&offset=${offset}&unread_only=${unread}`,
      ),
    enabled: open,
    refetchInterval: open ? 30000 : false,
    refetchOnWindowFocus: true,
  });
  useEffect(() => {
    if (inbox.data && offset && offset >= inbox.data.total)
      setOffset(Math.max(0, offset - PAGE_SIZE));
  }, [inbox.data, offset]);
  async function read(id?: string) {
    if (busy) return;
    setBusy(true);
    try {
      await post(id ? `/notifications/${id}/read` : "/notifications/read-all");
      await cache.invalidateQueries({ queryKey: ["notifications", userId] });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <NotificationBell
        count={summary.data?.unread_count}
        ready={!!summary.data}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={summary.error ? "消息读取失败，点击重试" : "消息通知"}
        onClick={() => {
          setOpen(true);
          summary.refetch();
        }}
      />
      {open &&
        createPortal(
          <Drawer
            title="消息通知"
            subtitle="当前作品已载入的任务通知；已读状态保存在本次浏览器会话。"
            onClose={() => setOpen(false)}
          >
            <div className="u-inbox-toolbar">
              <div role="group" aria-label="消息筛选">
                <button
                  type="button"
                  aria-pressed={!unread}
                  onClick={() => {
                    setUnread(false);
                    setOffset(0);
                  }}
                >
                  全部
                </button>
                <button
                  type="button"
                  aria-pressed={unread}
                  onClick={() => {
                    setUnread(true);
                    setOffset(0);
                  }}
                >
                  未读 {summary.data?.unread_count ?? ""}
                </button>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy || !summary.data?.unread_count}
                onClick={() => read()}
              >
                全部已读
              </button>
            </div>
            {inbox.isPending ? (
              <Spinner text="正在读取消息" />
            ) : inbox.error ? (
              <ErrorState error={inbox.error} retry={() => inbox.refetch()} />
            ) : inbox.data?.items.length ? (
              <>
                <ul className="u-inbox-list">
                  {inbox.data.items.map((item) => (
                    <li key={item.id} data-unread={item.status === "unread"}>
                      <span className="u-inbox-dot" aria-hidden="true" />
                      <div>
                        <strong>{item.name}</strong>
                        <p>{item.data.body}</p>
                        <time dateTime={item.created_at}>
                          {formatTime(item.created_at)}
                        </time>
                      </div>
                      {item.status === "unread" ? (
                        <button
                          type="button"
                          className="text-button"
                          aria-label={`标记已读：${item.name}`}
                          disabled={busy}
                          onClick={() => read(item.id)}
                        >
                          标记已读
                        </button>
                      ) : (
                        <span className="u-inbox-read">已读</span>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="u-inbox-pagination">
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={!offset}
                    onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  >
                    上一页
                  </button>
                  <span>
                    {offset + 1}–
                    {Math.min(offset + PAGE_SIZE, inbox.data.total)} /{" "}
                    {inbox.data.total}
                  </span>
                  <button
                    type="button"
                    className="button secondary small"
                    disabled={offset + PAGE_SIZE >= inbox.data.total}
                    onClick={() => setOffset(offset + PAGE_SIZE)}
                  >
                    下一页
                  </button>
                </div>
              </>
            ) : (
              <Empty
                title={unread ? "没有未读消息" : "暂时没有消息"}
                description="与你有关的系统事件会显示在这里。"
              />
            )}
          </Drawer>,
          document.body,
        )}
    </>
  );
}
