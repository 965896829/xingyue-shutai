"use client";
import { ConfigField, ConfigToggle } from "./platform-form";
import { Modal } from "./reference-ui";
import { useResourceDraft, type FormProps } from "./reference-detail-forms";
export const storageProviders = [
  ["aliyun", "阿里OSS存储"],
  ["cos", "腾讯云COS"],
  ["qiniu", "七牛OSS存储"],
  ["minio", "MinIO存储"],
  ["rains3", "雨云对象存储"],
  ["s3", "S3兼容对象存储"],
  ["local", "本地文件存储"],
];
export function StorageForm(props: FormProps) {
  const d = useResourceDraft(
      props.record
        ? props
        : {
            ...props,
            page: {
              ...props.page,
              fields: props.page.fields.map((f) =>
                f.key === "upload_enabled" ? { ...f, default: false } : f,
              ),
            },
          },
    ),
    v = d.values,
    provider = v.provider || v.driver || "s3",
    local = provider === "local";
  const text = (
    key: string,
    title: string,
    hint = "",
    placeholder = "",
    secret = false,
  ) => (
    <ConfigField title={title} hint={hint}>
      <input
        type={secret ? "password" : "text"}
        autoComplete={secret ? "new-password" : undefined}
        placeholder={
          secret && props.record?.configured_secrets?.includes(key)
            ? "已配置，留空保留"
            : placeholder
        }
        value={v[key] || ""}
        onChange={(e) => d.set(key, e.target.value)}
      />
    </ConfigField>
  );
  const toggle = (key: string, title: string) => (
    <ConfigToggle
      title={title}
      value={v[key] === true}
      onChange={(x) => d.set(key, x)}
    />
  );
  return (
    <Modal
      title="存储设置"
      onClose={props.onClose}
      className="storage-config-modal"
      footer={
        <button
          className="button primary"
          disabled={d.busy}
          onClick={() =>
            d.save(
              {
                driver: local ? "local" : "s3",
                provider,
                endpoint:
                  v.endpoint && !/^https?:\/\//.test(v.endpoint)
                    ? "https://" + v.endpoint
                    : v.endpoint,
              },
              d.name ||
                storageProviders.find(([key]) => key === provider)?.[1] ||
                "存储配置",
            )
          }
        >
          {d.busy ? "保存中…" : "保存"}
        </button>
      }
    >
      <div className="ref-form storage-config-fields">
        <ConfigField title="配置名称" hint="用于区分多个同类型存储配置">
          <input
            value={d.name}
            placeholder={
              storageProviders.find(([key]) => key === provider)?.[1]
            }
            onChange={(e) => d.setName(e.target.value)}
          />
        </ConfigField>
        {text("description", "存储描述")}
        <ConfigField title="支持文件类型" hint="不选择表示全部类型">
          <div className="capability-choices">
            {[
              ["image", "图片"],
              ["video", "视频"],
              ["audio", "音频"],
              ["document", "文档"],
              ["model", "3D 模型"],
              ["other", "其他"],
            ].map(([key, title]) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={(v.file_types || []).includes(key)}
                  onChange={(e) =>
                    d.set(
                      "file_types",
                      e.target.checked
                        ? [...(v.file_types || []), key]
                        : (v.file_types || []).filter((x: string) => x !== key),
                    )
                  }
                />
                {title}
              </label>
            ))}
          </div>
        </ConfigField>
        {toggle("upload_enabled", "启用状态-上传")}
        {toggle("return_enabled", "启用状态-返图")}
        {toggle("api_return_enabled", "启用状态-API返图")}
        <ConfigField
          title="存储有效期"
          hint="用于控制文件转存到当前存储后的生命周期标签；不过期表示不写入过期标签"
        >
          <select
            value={v.retention_days || 0}
            onChange={(e) => d.set("retention_days", Number(e.target.value))}
          >
            {[0, 1, 3, 7, 15, 30, 90, 180, 365].map((n) => (
              <option key={n} value={n}>
                {n ? `${n} 天` : "不过期"}
              </option>
            ))}
          </select>
        </ConfigField>
        <ConfigField title="优先级">
          <input
            type="number"
            min={0}
            value={v.priority ?? 100}
            onChange={(e) => d.set("priority", Number(e.target.value))}
          />
        </ConfigField>
        {!local && (
          <>
            {text(
              "access_key",
              "ACCESS_KEY",
              "存储空间 key，由云存储提供商提供",
              "",
              true,
            )}
            {text(
              "secret_key",
              "SECRET_KEY",
              "存储空间密钥，由云存储提供商提供",
              "密钥信息保存后不再显示",
              true,
            )}
            {text("bucket", "BUCKET", "存储空间名称", "例如 novel-assets")}
            {text(
              "endpoint",
              provider === "aliyun"
                ? "OSS_ENDPOINT"
                : provider === "cos"
                  ? "COS_ENDPOINT"
                  : "S3_ENDPOINT",
              "对象存储服务端点",
              "minio.example.com",
            )}
            {text(
              "public_url",
              "空间域名",
              "用于配置对象存储的访问域名",
              "https://s3.example.com",
            )}
            {toggle("virtual_host", "忽略bucket在路径中")}
            <ConfigField title="区域">
              <input
                value={v.region || ""}
                placeholder={provider === "cos" ? "ap-guangzhou" : "us-east-1"}
                onChange={(e) => d.set("region", e.target.value)}
              />
            </ConfigField>
          </>
        )}
        <ConfigField title="最大上传 MB">
          <input
            type="number"
            min={1}
            max={100}
            value={v.max_mb ?? 20}
            onChange={(e) => d.set("max_mb", Number(e.target.value))}
          />
        </ConfigField>
        <ConfigField title="单份备份上限 MB" hint="用于整库备份与备份导入">
          <input
            type="number"
            min={1}
            max={200}
            step={1}
            value={v.backup_max_mb ?? 200}
            onChange={(e) => d.set("backup_max_mb", Number(e.target.value))}
          />
        </ConfigField>
      </div>
    </Modal>
  );
}
