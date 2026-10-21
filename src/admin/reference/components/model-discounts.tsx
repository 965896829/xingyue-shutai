"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Percent, Pencil, RotateCcw, Save } from "lucide-react";
import { api, put } from "@reference/lib/api";
import { ErrorState, Spinner, useToast } from "./ui";
import { Modal, RefEmpty, SearchBox } from "./reference-ui";

type Model = {
  id: string;
  name: string;
  model: string;
  vendor: string;
  capability: string;
};
type Values = { default_discount: number; overrides: Record<string, number> };
type Settings = Values & {
  version: number;
  organization: string;
  organizations: { id: string; name: string }[];
  models: Model[];
};
const abilities: Record<string, string> = {
  text: "文本生成",
  image: "图像生成",
  video: "视频生成",
  audio: "音频生成",
  embedding: "嵌入",
  rerank: "文本重排",
};
const ratio = (value: number) => `${Number((value * 100).toFixed(4))}%`;
const valid = (value: number) =>
  Number.isFinite(value) && value >= 0 && value <= 1000;

export function ModelDiscounts() {
  const cache = useQueryClient(),
    toast = useToast();
  const [organization, setOrganization] = useState("");
  const q = useQuery<Settings>({
    queryKey: ["model-discounts", organization],
    queryFn: () =>
      api(
        `/admin/model-discounts?organization=${encodeURIComponent(organization)}`,
      ),
    refetchOnWindowFocus: false,
  });
  const [draft, setDraft] = useState<Values | null>(null),
    [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(""),
    [vendor, setVendor] = useState(""),
    [source, setSource] = useState("");
  const [selected, setSelected] = useState<string[]>([]),
    [editing, setEditing] = useState<{ ids: string[]; batch: boolean } | null>(
      null,
    );
  if (q.isPending) return <Spinner />;
  if (q.isError)
    return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const saved = q.data,
    values = draft || saved;
  const dirty =
    values.default_discount !== saved.default_discount ||
    JSON.stringify(values.overrides) !== JSON.stringify(saved.overrides);
  const shown = saved.models.filter(
    (m) =>
      (!vendor || m.vendor === vendor) &&
      (!source ||
        (source === "custom") === Object.hasOwn(values.overrides, m.id)) &&
      `${m.name} ${m.model} ${m.vendor}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const customCount = saved.models.filter((m) =>
    Object.hasOwn(values.overrides, m.id),
  ).length;
  const allSelected =
    shown.length > 0 && shown.every((m) => selected.includes(m.id));
  async function save() {
    if (busy || !valid(values.default_discount)) return;
    setBusy(true);
    try {
      const next = await put<Settings>("/admin/model-discounts", {
        default_discount: values.default_discount,
        overrides: values.overrides,
        organization,
        expected_version: saved.version,
      });
      cache.setQueryData(["model-discounts", organization], {
        ...saved,
        ...next,
      });
      setDraft(null);
      await cache.invalidateQueries({
        predicate: (query) => String(query.queryKey[0]).includes("estimate"),
      });
      toast("模型折扣已保存，后续调用按新折扣计费");
    } catch (error) {
      toast((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="model-discounts-page">
      <header className="model-discounts-heading">
        <div>
          <h1>模型折扣</h1>
          <p>独立维护组织的默认计费折扣与模型专属折扣。</p>
        </div>
        <span className="parity-chip">{saved.models.length}</span>
        <div className="ref-actions">
          <button
            className="button secondary"
            disabled={busy || !dirty}
            onClick={() => {
              setDraft(null);
              void q.refetch();
            }}
          >
            <RotateCcw size={15} />
            撤销修改
          </button>
          <button
            className="button primary"
            disabled={busy || !dirty || !valid(values.default_discount)}
            onClick={save}
          >
            <Save size={15} />
            {busy ? "保存中…" : "保存变更"}
          </button>
        </div>
      </header>
      <div className="model-discounts-default">
        <label>
          组织
          <select
            aria-label="选择组织"
            value={organization}
            disabled={busy || dirty}
            onChange={(e) => {
              setOrganization(e.target.value);
              setDraft(null);
              setSelected([]);
            }}
          >
            {saved.organizations.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          默认计费折扣
          <input
            aria-label="默认计费折扣"
            type="number"
            min="0"
            max="1000"
            step="0.01"
            value={
              Number.isFinite(values.default_discount)
                ? values.default_discount
                : ""
            }
            disabled={busy}
            onChange={(e) =>
              setDraft({
                ...values,
                default_discount:
                  e.target.value === "" ? NaN : Number(e.target.value),
              })
            }
          />
        </label>
        <span>
          未单独设置的模型按标准价格的{" "}
          {valid(values.default_discount)
            ? ratio(values.default_discount)
            : "—"}{" "}
          计费
        </span>
      </div>
      <p className="model-discounts-hint">
        组织来自用户与会员配置。用户有多个所属组织时按首个组织计费，组织尚未设置折扣时跟随当前站点。
        {dirty && " 当前有未保存修改，请先保存或撤销再切换组织。"}
      </p>
      <div className="model-discounts-toolbar">
        <SearchBox
          value={search}
          onChange={setSearch}
          placeholder="模糊搜索模型名称、别名或厂商"
        />
        <select
          aria-label="模型厂商"
          value={vendor}
          onChange={(e) => setVendor(e.target.value)}
        >
          <option value="">全部厂商</option>
          {[...new Set(saved.models.map((m) => m.vendor).filter(Boolean))]
            .sort()
            .map((v) => (
              <option key={v}>{v}</option>
            ))}
        </select>
        <select
          aria-label="折扣规则来源"
          value={source}
          onChange={(e) => setSource(e.target.value)}
        >
          <option value="">全部规则</option>
          <option value="default">使用默认</option>
          <option value="custom">专属折扣</option>
        </select>
        <span>
          筛选结果 {shown.length} / {saved.models.length} · 已选择{" "}
          {selected.length} · {customCount} 个专属折扣
        </span>
        <button
          className="button secondary"
          disabled={!shown.length || busy}
          onClick={() =>
            setSelected(
              allSelected
                ? selected.filter((id) => !shown.some((m) => m.id === id))
                : [...new Set([...selected, ...shown.map((m) => m.id)])],
            )
          }
        >
          {allSelected ? "取消选择筛选结果" : "全选筛选结果"}（{shown.length}）
        </button>
        <button
          className="button secondary"
          disabled={!selected.length || busy}
          onClick={() => setEditing({ ids: selected, batch: true })}
        >
          批量设置{selected.length ? `（${selected.length}）` : ""}
        </button>
      </div>
      <div className="model-discount-grid">
        {shown.map((m) => {
          const custom = Object.hasOwn(values.overrides, m.id),
            current = custom ? values.overrides[m.id] : values.default_discount;
          return (
            <article
              className={`model-discount-card ${selected.includes(m.id) ? "selected" : ""}`}
              key={m.id}
            >
              <header>
                <input
                  type="checkbox"
                  aria-label={`选择${m.name}`}
                  checked={selected.includes(m.id)}
                  onChange={(e) =>
                    setSelected((ids) =>
                      e.target.checked
                        ? [...ids, m.id]
                        : ids.filter((id) => id !== m.id),
                    )
                  }
                />
                <Percent size={23} />
                <div>
                  <strong>{m.name}</strong>
                  <small>
                    {m.vendor || "—"} · {m.model}
                  </small>
                </div>
                <span className="parity-chip">
                  {abilities[m.capability] || m.capability}
                </span>
              </header>
              <dl>
                <div>
                  <dt>默认折扣</dt>
                  <dd>{values.default_discount.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>当前折扣</dt>
                  <dd>{current.toFixed(2)}</dd>
                </div>
                <div>
                  <dt>计费比例</dt>
                  <dd>{valid(current) ? ratio(current) : "—"}</dd>
                </div>
              </dl>
              <footer>
                <span className={custom ? "model-discount-custom" : ""}>
                  {custom ? "专属折扣" : "使用默认"}
                </span>
                <button
                  className="link-button"
                  disabled={busy}
                  onClick={() => setEditing({ ids: [m.id], batch: false })}
                >
                  <Pencil size={13} />
                  {custom ? "修改专属折扣" : "设置专属折扣"}
                </button>
              </footer>
            </article>
          );
        })}
      </div>
      {!shown.length && <RefEmpty text="没有匹配的模型" />}
      {editing && (
        <DiscountEditor
          batch={editing.batch}
          models={saved.models.filter((m) => editing.ids.includes(m.id))}
          values={values}
          onClose={() => setEditing(null)}
          onApply={(value) => {
            const overrides = { ...values.overrides };
            for (const id of editing.ids) {
              if (value === null) delete overrides[id];
              else overrides[id] = value;
            }
            setDraft({ ...values, overrides });
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function DiscountEditor({
  batch,
  models,
  values,
  onClose,
  onApply,
}: {
  batch: boolean;
  models: Model[];
  values: Values;
  onClose: () => void;
  onApply: (value: number | null) => void;
}) {
  const first = models[0],
    initial = first && Object.hasOwn(values.overrides, first.id);
  const [custom, setCustom] = useState(batch || !!initial),
    [value, setValue] = useState(
      initial ? values.overrides[first.id] : values.default_discount,
    );
  return (
    <Modal
      title={batch ? "批量设置模型折扣" : "设置模型折扣"}
      onClose={onClose}
      footer={
        <>
          <button className="button secondary" onClick={onClose}>
            取 消
          </button>
          <button
            className="button primary"
            disabled={custom && !valid(value)}
            onClick={() => onApply(custom ? value : null)}
          >
            {batch ? "应用到已选模型" : "确 定"}
          </button>
        </>
      }
    >
      {batch ? (
        <p>已选择 {models.length} 个模型</p>
      ) : (
        <div className="model-discounts-model">
          <strong>{first?.name}</strong>
          <small>
            {first?.vendor} · {first?.model}
          </small>
        </div>
      )}
      <div className="model-discount-mode">
        <label>
          <input
            type="radio"
            name="discount-mode"
            checked={!custom}
            onChange={() => setCustom(false)}
          />
          {batch
            ? "恢复默认折扣"
            : `使用默认折扣 ${values.default_discount.toFixed(2)}`}
        </label>
        <label>
          <input
            type="radio"
            name="discount-mode"
            checked={custom}
            onChange={() => setCustom(true)}
          />
          设置专属折扣
        </label>
      </div>
      {custom && (
        <label className="model-discount-value">
          专属折扣
          <input
            type="number"
            aria-label="专属折扣"
            min="0"
            max="1000"
            step="0.01"
            value={Number.isFinite(value) ? value : ""}
            onChange={(e) =>
              setValue(e.target.value === "" ? NaN : Number(e.target.value))
            }
          />
          <small>
            {batch
              ? "所选模型将统一"
              : `${Number.isFinite(value) ? value.toFixed(2) : "—"} 表示`}
            按标准价格的 {valid(value) ? ratio(value) : "—"} 计费
          </small>
        </label>
      )}
    </Modal>
  );
}
