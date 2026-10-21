"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, post, formatTime } from "@reference/lib/api";
import { Modal } from "./reference-ui";
import { Drawer, ErrorState, Spinner, useToast } from "./ui";

const labels = {
  pricingRules: "定价",
  policySets: "模型运行策略",
  platforms: "平台数据（包含平台和模型权限）",
  defaultBindings: "全局调度策略",
};

export function PlatformMigration({
  refresh,
  create,
}: {
  refresh: () => void;
  create: () => void;
}) {
  const [open, setOpen] = useState(false),
    [guide, setGuide] = useState(false),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<any>(null),
    [options, setOptions] = useState({
      pricingRules: true,
      policySets: true,
      platforms: true,
      defaultBindings: true,
    }),
    toast = useToast();
  const q = useQuery({
    queryKey: ["platform-migration"],
    queryFn: () => api("/admin/platform-migration/preview"),
    enabled: open,
  });
  async function migrate() {
    setBusy(true);
    try {
      const r = await post("/admin/platform-migration/run", {
        ...options,
        entries: q.data.items.map((r: any) => ({
          id: r.id,
          version: r.version,
        })),
        globals: q.data.globals,
      });
      setResult(r);
      await q.refetch();
      refresh();
      toast(r.message);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button
        type="button"
        className="button secondary"
        onClick={() => setGuide(true)}
      >
        从 EasyAI 接入指引
      </button>
      <button
        type="button"
        className="button secondary"
        onClick={() => {
          setResult(null);
          setOpen(true);
        }}
        disabled title="旧平台服务与迁移接口尚未接入"
      >
        一键迁移旧平台数据 · 尚未接入
      </button>
      {guide && (
        <Drawer
          title="EasyAI 平台接入步骤"
          subtitle="按顺序配置账号授权和模型绑定。"
          onClose={() => setGuide(false)}
        >
          <ol className="platform-guide-steps">
            <li>
              <h3>注册并登录 EasyAI 平台</h3>
              <p>打开 EasyAI 官网，完成账号注册并登录。</p>
              <a
                className="button secondary"
                href="https://51easyai.com/home"
                target="_blank"
                rel="noreferrer"
              >
                前往 51easyai.com/home
              </a>
            </li>
            <li>
              <h3>创建 API Key</h3>
              <p>在左侧菜单进入个人空间 → API KEY，创建并复制新的 API Key。</p>
            </li>
            <li>
              <h3>新增 EasyAI 平台并填写 Key</h3>
              <p>
                将模型厂商选为 EasyAI，进入“计费授权”填写刚刚创建的 API Key。
              </p>
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  setGuide(false);
                  create();
                }}
              >
                新增 EasyAI 平台
              </button>
            </li>
            <li>
              <h3>选择并保存模型</h3>
              <p>
                在“模型”标签页点击“添加模型”，筛选厂商或能力后点击“全选搜索结果”，再点击“添加选中”。保存后可查看绑定的模型数量，也可先检测当前账号的模型目录。
              </p>
            </li>
            <li>
              <h3>余额充值</h3>
              <p>正式调用按供应商的计费规则扣费，使用前请检查账户余额。</p>
              <a
                className="button secondary"
                href="https://51easyai.com/pay/account"
                target="_blank"
                rel="noreferrer"
              >
                前往充值页
              </a>
            </li>
          </ol>
          <a
            className="button secondary"
            href="https://karni9c557h.feishu.cn/wiki/C2c9wiuvciquWOk3UpwcrAd7nPb?from=from_copylink"
            target="_blank"
            rel="noreferrer"
          >
            查看模型清单与价格
          </a>
        </Drawer>
      )}
      {open && (
        <Modal
          title="一键迁移旧平台数据"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          footer={
            <>
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                取消
              </button>
              <button
                className="button primary"
                type="button"
                disabled={
                  busy || !q.data || !Object.values(options).some(Boolean)
                }
                onClick={migrate}
              >
                {busy ? "迁移中…" : "开始迁移"}
              </button>
            </>
          }
        >
          <div className="parity-stack">
            {Object.entries(labels).map(([key, text]) => (
              <label className="check-field" key={key}>
                <input
                  type="checkbox"
                  checked={options[key as keyof typeof options]}
                  onChange={(e) =>
                    setOptions((v) => ({ ...v, [key]: e.target.checked }))
                  }
                />
                {text}
              </label>
            ))}
          </div>
          <p className="ref-field-help">
            未选择定价时沿用现有定价；未选择模型运行策略时跟随基础模型。全局调度策略会迁移旧配置中的重试、自动禁用和优先级降低关键词。相同定价和相同限流配置优先复用。
          </p>
          {q.isPending ? (
            <Spinner />
          ) : q.error ? (
            <ErrorState error={q.error} />
          ) : (
            <p className="muted">
              当前实例可迁移 {q.data.items.length} 个旧平台、
              {q.data.globals.length} 份旧全局配置。
            </p>
          )}
          {result && (
            <div className="parity-notice" role="status">
              <strong>{result.message}</strong>
              {Object.entries(labels).map(([key, text]) => (
                <p key={key}>
                  {text}：{result.counts[key]}
                </p>
              ))}
            </div>
          )}
          {!!q.data?.history?.length && (
            <details>
              <summary>最近迁移记录</summary>
              {q.data.history.map((r: any) => (
                <p key={r.id}>
                  {formatTime(r.created_at)} · {r.message}
                </p>
              ))}
            </details>
          )}
        </Modal>
      )}
    </>
  );
}
