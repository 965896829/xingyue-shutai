"use client";
import { useRef, useState } from "react";
import { useRouter } from "@reference/router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Upload, FileText, Check, Database } from "lucide-react";
import { api, type DataRecord } from "@reference/lib/api";
import { ConfigField } from "./platform-form";
import { Modal } from "./reference-ui";
import { useToast } from "./ui";
import { DeleteButton } from "./interaction/delete-button";

const accepts = ".pdf,.docx,.txt,.md,.xlsx,.csv,.html,.htm,.json";
export function SkillPackageUpload({
  onDone,
}: {
  onDone: (r: DataRecord) => void;
}) {
  const input = useRef<HTMLInputElement>(null),
    toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        className="button primary"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <Upload size={14} />
        {busy ? "正在上传…" : "上传技能"}
      </button>
      <input
        ref={input}
        className="file-input"
        type="file"
        accept=".zip"
        aria-label="选择技能 ZIP 文件"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          try {
            const body = new FormData();
            body.append("file", file);
            const row = await api("/admin/skills/upload-package", {
              method: "POST",
              body,
            });
            onDone(row);
            toast("技能已上传，可检查内容后启用");
          } catch (error) {
            toast((error as Error).message, true);
          } finally {
            setBusy(false);
            if (input.current) input.current.value = "";
          }
        }}
      />
    </>
  );
}

export function KnowledgeCreate() {
  const router = useRouter(),
    cache = useQueryClient(),
    toast = useToast(),
    input = useRef<HTMLInputElement>(null),
    requestKey = useRef<string | null>(null);
  const [files, setFiles] = useState<File[]>([]),
    [service, setService] = useState("local"),
    [step, setStep] = useState(0),
    [empty, setEmpty] = useState(false),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [scope, setScope] = useState("private"),
    [chunkSize, setChunkSize] = useState(800),
    [preview, setPreview] = useState<any[]>([]),
    [busy, setBusy] = useState(false),
    [dragging, setDragging] = useState(false),
    [created, setCreated] = useState<DataRecord | null>(null);
  const services = useQuery({
    queryKey: ["knowledge-services"],
    queryFn: () => api("/admin/knowledge-services"),
  });
  function add(items: File[]) {
    const bad = items.find(
      (f) =>
        f.size > 15 * 1024 * 1024 ||
        !accepts.split(",").some((ext) => f.name.toLowerCase().endsWith(ext)),
    );
    if (bad) {
      toast(
        bad.size > 15 * 1024 * 1024
          ? "单个文件不超过 15 MB"
          : "不支持的文件格式：" + bad.name,
        true,
      );
      return;
    }
    setFiles((old) => {
      const added = items.filter(
        (f) =>
          !old.some(
            (x) =>
              x.name === f.name &&
              x.size === f.size &&
              x.lastModified === f.lastModified,
          ),
      );
      if (old.length + added.length > 20) {
        toast("一次最多上传 20 个文件", true);
        return old;
      }
      requestKey.current = null;
      return [...old, ...added];
    });
  }
  async function next() {
    setBusy(true);
    try {
      const body = new FormData();
      files.forEach((f) => body.append("files", f));
      const out = await api("/admin/knowledge/preview-files", {
        method: "POST",
        body,
      });
      setPreview(out.items);
      if (!name) setName(files[0]?.name.replace(/\.[^.]+$/, "") || "");
      setStep(1);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function create(isEmpty = false) {
    setBusy(true);
    try {
      const body = new FormData();
      body.append(
        "config",
        JSON.stringify({
          name,
          service_id: service,
          data: {
            description,
            scope,
            chunk_size: chunkSize,
            embedding_model: "sandbox-hash-embedding",
            retrieval_mode: "lexical",
          },
        }),
      );
      if (!isEmpty) files.forEach((f) => body.append("files", f));
      requestKey.current ??= crypto.randomUUID();
      const row = await api("/admin/knowledge/create-bundle", {
        method: "POST",
        body,
        headers: { "Idempotency-Key": requestKey.current },
      });
      setCreated(row);
      setEmpty(false);
      setStep(2);
      await cache.invalidateQueries({ queryKey: ["collection"] });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="ref-page knowledge-create-page">
      <div className="ref-toolbar">
        <button
          className="button secondary"
          onClick={() => router.push("/admin/knowledge")}
        >
          <ArrowLeft size={15} />
          知识库
        </button>
        {step > 0 && (
          <div className="knowledge-steps">
            {["上传文件", "处理与预览", "完成"].map((text, i) => (
              <span className={step === i ? "active" : ""} key={text}>
                {i + 1}. {text}
              </span>
            ))}
          </div>
        )}
      </div>
      {step === 0 ? (
        <div
          className="knowledge-upload-stage"
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              add(Array.from(e.clipboardData.files));
            }
          }}
        >
          <ConfigField title="选择知识库服务">
            <select
              value={service}
              onChange={(e) => {
                setService(e.target.value);
                requestKey.current = null;
              }}
            >
              <option value="local">本地知识库服务</option>
              {services.data?.items
                .filter((r: DataRecord) => r.status === "active")
                .map((r: DataRecord) => (
                  <option value={r.id} key={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </ConfigField>
          <div
            className={`knowledge-dropzone ${dragging ? "dragging" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              add(Array.from(e.dataTransfer.files));
            }}
          >
            <Upload size={43} strokeWidth={1.25} />
            <p>
              拖拽文件至此，或者{" "}
              <button
                className="link-button"
                onClick={() => input.current?.click()}
              >
                点击选择文件
              </button>
            </p>
            <p className="ref-field-help">
              支持多文件上传，也可以使用 Ctrl+V 粘贴
            </p>
            <div className="knowledge-filetypes">
              {["PDF", "DOCX", "TXT", "MD", "XLSX", "CSV", "HTML", "JSON"].map(
                (t) => (
                  <span key={t}>{t}</span>
                ),
              )}
            </div>
            <small>单个文件不超过 15MB</small>
            <input
              ref={input}
              className="file-input"
              aria-label="选择知识库文件"
              multiple
              type="file"
              accept={accepts}
              onChange={(e) => {
                add(Array.from(e.target.files || []));
                e.target.value = "";
              }}
            />
          </div>
          {files.length > 0 && (
            <div className="knowledge-upload-list">
              {files.map((f, i) => (
                <div key={f.name + f.lastModified}>
                  <FileText size={18} />
                  <span>{f.name}</span>
                  <small>{(f.size / 1024).toFixed(1)} KB</small>
                  <DeleteButton
                    aria-label={"移除 " + f.name}
                    onClick={() => {
                      setFiles((old) => old.filter((_, n) => n !== i));
                      requestKey.current = null;
                    }}
                  >
                    移除
                  </DeleteButton>
                </div>
              ))}
            </div>
          )}
          <footer>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setEmpty(true);
                requestKey.current = null;
              }}
            >
              创建空知识库
            </button>
            <button
              className="button primary"
              disabled={busy || !files.length}
              onClick={next}
            >
              {busy ? "正在读取文件…" : "下一步"}
            </button>
          </footer>
        </div>
      ) : step === 1 ? (
        <div className="knowledge-config-stage">
          <div className="ref-form">
            <ConfigField title="知识库名称 *">
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  requestKey.current = null;
                }}
              />
            </ConfigField>
            <ConfigField title="知识库描述">
              <textarea
                rows={3}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  requestKey.current = null;
                }}
              />
            </ConfigField>
            <ConfigField title="资料范围">
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  requestKey.current = null;
                }}
              >
                <option value="private">仅自己可用</option>
                <option value="platform">平台共享</option>
              </select>
            </ConfigField>
            <ConfigField
              title="分段最大长度"
              hint="按字符分段，相邻片段保留 100 字符重叠。"
            >
              <input
                type="number"
                min={200}
                max={3000}
                value={chunkSize}
                onChange={(e) => {
                  setChunkSize(Number(e.target.value));
                  requestKey.current = null;
                }}
              />
            </ConfigField>
            <p className="ref-field-help">
              {service === "local"
                ? "创建后建立离线词法索引。语义模型及检索预算可在文档管理中配置。"
                : "使用所选知识服务处理资料。沙箱模式在本地验证；正式模式可在文档管理中同步处理进度。"}
            </p>
            <div className="ref-toolbar">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setStep(0)}
              >
                上一步
              </button>
              <button
                className="button primary"
                disabled={
                  busy || !name.trim() || chunkSize < 200 || chunkSize > 3000
                }
                onClick={() => create()}
              >
                {busy ? "正在创建…" : "保存并处理"}
              </button>
            </div>
          </div>
          <section className="knowledge-preview">
            <h3>文档预览</h3>
            {preview.map((p, i) => (
              <details key={p.name} open={i === 0}>
                <summary>
                  {p.name} · {p.characters.toLocaleString()} 字
                </summary>
                <pre>{p.preview}</pre>
              </details>
            ))}
          </section>
        </div>
      ) : (
        <div className="knowledge-created">
          <Check size={40} />
          <h2>知识库已创建</h2>
          <p>
            {created?.name} · {created?.data.document_count || 0} 个文档 ·{" "}
            {created?.data.chunk_count || 0} 个分段
          </p>
          <button
            className="button primary"
            onClick={() => router.push("/admin/knowledge")}
          >
            前往知识库
          </button>
        </div>
      )}
      {empty && (
        <Modal
          title="创建空知识库"
          icon={<Database size={18} />}
          onClose={() => setEmpty(false)}
          footer={
            <>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setEmpty(false)}
              >
                取 消
              </button>
              <button
                className="button primary"
                disabled={busy || !name.trim()}
                onClick={() => create(true)}
              >
                {busy ? "创建中…" : "创建"}
              </button>
            </>
          }
        >
          <p className="ref-description">
            空知识库中还没有文档，你可以在今后任何时候上传文档至该知识库。
          </p>
          <ConfigField title="知识库名称 *">
            <input
              autoFocus
              value={name}
              placeholder="请输入知识库名称"
              onChange={(e) => {
                setName(e.target.value);
                requestKey.current = null;
              }}
            />
          </ConfigField>
        </Modal>
      )}
    </section>
  );
}
