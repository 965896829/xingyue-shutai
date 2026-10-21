"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@reference/lib/api";
import { ConfigField } from "./platform-form";
import { Modal } from "./reference-ui";
import { useResourceDraft, type FormProps } from "./reference-detail-forms";
export function MemberForm(props: FormProps) {
  const s = useResourceDraft(props),
    v = s.values,
    [search, setSearch] = useState("");
  const users = useQuery({
    queryKey: ["member-user-options", search],
    queryFn: () =>
      api("/admin/users?page_size=200&q=" + encodeURIComponent(search)),
  });
  const date = v.expires_at ? new Date(v.expires_at) : null,
    local =
      date && !Number.isNaN(date.getTime())
        ? new Date(date.getTime() - date.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16)
        : "";
  return (
    <Modal
      title={props.record ? "编辑会员" : "新增会员"}
      onClose={props.onClose}
      footer={
        <>
          <button className="button secondary" onClick={props.onClose}>
            取 消
          </button>
          <button
            className="button primary"
            disabled={s.busy}
            onClick={() =>
              s.save(
                { starts_at: v.starts_at || new Date().toISOString() },
                props.record?.name ||
                  `${users.data?.items.find((u: any) => u.id === v.user_id)?.nickname || "用户"} · ${v.organization || "会员"}`,
              )
            }
          >
            保 存
          </button>
        </>
      }
    >
      <div className="ref-form">
        <ConfigField title="用户 *">
          <input
            placeholder="搜索用户"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            aria-label="用户"
            value={v.user_id || ""}
            onChange={(e) => s.set("user_id", e.target.value)}
          >
            <option value="">请选择用户</option>
            {v.user_id &&
              !users.data?.items.some((u: any) => u.id === v.user_id) && (
                <option value={v.user_id}>
                  {props.record?.name || v.user_id}
                </option>
              )}
            {users.data?.items.map((u: any) => (
              <option key={u.id} value={u.id}>
                {u.nickname || u.username}（{u.username}）
              </option>
            ))}
          </select>
        </ConfigField>
        <ConfigField title="会员组织">
          <input
            list="member-organizations"
            value={v.organization || ""}
            placeholder="选择或填写会员组织"
            onChange={(e) => s.set("organization", e.target.value)}
          />
          <datalist id="member-organizations">
            {[
              ...new Set<string>(
                (users.data?.items || []).flatMap(
                  (u: any) => u.meta?.organizations || [],
                ),
              ),
            ].map((o) => (
              <option key={o} value={o} />
            ))}
          </datalist>
        </ConfigField>
        <ConfigField title="过期时间">
          <input
            type="datetime-local"
            value={local}
            onChange={(e) =>
              s.set(
                "expires_at",
                e.target.value ? new Date(e.target.value).toISOString() : null,
              )
            }
          />
        </ConfigField>
      </div>
    </Modal>
  );
}
