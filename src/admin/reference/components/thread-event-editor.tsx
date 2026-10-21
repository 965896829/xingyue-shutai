"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@reference/lib/api";
import { ErrorState } from "./ui";

export function ThreadEventEditor({
  pid,
  admin = false,
  fact,
  change,
}: {
  pid: string;
  admin?: boolean;
  fact: any;
  change: (v: any) => void;
}) {
  const path = `${admin ? "/admin/structured" : "/studio"}/projects/${pid}`;
  const q = useQuery({
    queryKey: ["thread-event-options", path],
    queryFn: () => api(path + "/thread-options"),
  });
  const t = fact.thread;
  return (
    <div className="mw mw-slot">
      <label className="mw-check">
        <input
          type="checkbox"
          checked={!!t}
          onChange={(e) =>
            change(
              e.target.checked
                ? {
                    ...fact,
                    memory: null,
                    category: "foreshadow",
                    kind: "canonical",
                    attributes: {},
                    thread: { thread_id: "", event: "setup", depends_on: [] },
                  }
                : { ...fact, thread: null },
            )
          }
        />
        关联承诺的实际事件
      </label>
      {t && (
        <>
          {q.error && <ErrorState error={q.error} />}
          <p className="mw-note">
            须有对应原文并经作者确认。预期兑现章节不会自动变成实际兑现。
          </p>
          <div className="mw-grid">
            <label>
              关联承诺
              <select
                value={t.thread_id}
                onChange={(e) =>
                  change({
                    ...fact,
                    thread: { ...t, thread_id: e.target.value },
                  })
                }
              >
                <option value="">请选择已登记的承诺</option>
                {q.data?.items.map((r: any) => (
                  <option key={r.id} value={r.id}>
                    {r.title} · {r.worldline_id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              正文中的事件
              <select
                value={t.event}
                onChange={(e) =>
                  change({ ...fact, thread: { ...t, event: e.target.value } })
                }
              >
                <option value="setup">出现 / 埋下</option>
                <option value="develop">推进</option>
                <option value="payoff">兑现</option>
                <option value="abandon">正文中放弃</option>
              </select>
            </label>
          </div>
          <p className="mw-note">
            只有出现证据确认后，才能记录推进或兑现；同章发生多个事件时，请按正文顺序排列方案。新承诺请先在“故事规划与承诺”登记。
          </p>
        </>
      )}
    </div>
  );
}
