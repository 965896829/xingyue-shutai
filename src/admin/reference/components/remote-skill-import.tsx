"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { post } from "@reference/lib/api";
import { Modal } from "./reference-ui";
import { useToast } from "./ui";

export function RemoteSkillImport() {
  const cache = useQueryClient(),
    toast = useToast();
  const [open, setOpen] = useState(false),
    [url, setUrl] = useState(""),
    [preview, setPreview] = useState<any>(null),
    [name, setName] = useState(""),
    [description, setDescription] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <>
      <button
        className="button secondary"
        onClick={() => {
          setOpen(true);
          setPreview(null);
          setReviewed(false);
        }}
      >
        从远程链接导入
      </button>
      {open && (
        <Modal
          title="远程技能预览与导入"
          wide
          onClose={() => setOpen(false)}
          footer={
            preview && (
              <button
                className="button primary"
                disabled={
                  busy || !reviewed || !name.trim() || !description.trim()
                }
                onClick={async () => {
                  setBusy(true);
                  try {
                    await post("/admin/skills/remote/import", {
                      preview_id: preview.id,
                      sha256: preview.sha256,
                      name,
                      description,
                      version: "1.0.0",
                      reviewed,
                    });
                    await cache.invalidateQueries({ queryKey: ["records"] });
                    await cache.invalidateQueries({ queryKey: ["collection"] });
                    setOpen(false);
                    toast("已保存技能草稿，可在审核指令后启用");
                  } catch (e) {
                    toast((e as Error).message, true);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                导入技能草稿
              </button>
            )
          }
        >
          <label className="field">
            技能 ZIP 链接
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…/skill.zip"
            />
          </label>
          <button
            className="button secondary"
            disabled={busy || !url}
            onClick={async () => {
              setBusy(true);
              setPreview(null);
              setReviewed(false);
              try {
                setPreview(await post("/admin/skills/remote/preview", { url }));
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            下载并预览
          </button>
          <p className="ref-field-help">
            支持公开 HTTPS ZIP，包括 GitHub
            独立技能发布包。导入只保存指令和文件，不执行包内脚本或自动安装依赖。
          </p>
          {preview && (
            <>
              <p className="muted">SHA-256：{preview.sha256}</p>
              <label className="field">
                技能名称
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="field">
                用途说明
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <details open>
                <summary>SKILL.md 指令</summary>
                <pre
                  style={{
                    whiteSpace: "pre-wrap",
                    maxHeight: 300,
                    overflow: "auto",
                  }}
                >
                  {preview.instructions}
                </pre>
              </details>
              <details>
                <summary>{preview.files.length} 个文件</summary>
                <pre style={{ maxHeight: 180, overflow: "auto" }}>
                  {preview.files.join("\n")}
                </pre>
              </details>
              <label>
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{" "}
                我已检查来源、指令与文件清单
              </label>
            </>
          )}
        </Modal>
      )}
    </>
  );
}
