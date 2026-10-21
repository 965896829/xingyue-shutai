"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { ConfigField, ConfigToggle } from "./platform-form";
import { Modal } from "./reference-ui";
import { DeleteButton } from "./interaction/delete-button";
import { useResourceDraft, type FormProps } from "./reference-detail-forms";

export function MCPServerForm(props: FormProps) {
  const { record, onClose } = props,
    d = useResourceDraft(props),
    v = d.values;
  const initial = () =>
    v.auth_type === "bearer" || v.auth_type === "header"
      ? "headers"
      : v.auth_type || "none";
  const [auth, setAuth] = useState(initial),
    [headers, setHeaders] = useState<{ name: string; value: string }[]>(() =>
      v.headers?.length
        ? v.headers.map((h: any) => ({ name: h.name, value: "" }))
        : v.auth_type === "bearer"
          ? [{ name: "Authorization", value: "" }]
          : v.auth_type === "header"
            ? [{ name: v.auth_header || "X-API-Key", value: "" }]
            : [],
    );
  const [timeout, setTimeout] = useState(
    record?.data.timeout_ms ??
      (record?.data.timeout ? record.data.timeout * 1000 : 300000),
  );
  const [error, setError] = useState("");
  const [argsText, setArgsText] = useState(JSON.stringify(v.args || []));
  function save() {
    setError("");
    if (!d.name.trim() || (!v.url && v.transport !== "stdio")) {
      setError("请填写名称与 Endpoint");
      return;
    }
    if (
      auth === "oauth2" &&
      v.oauth_registration === "pre_registered" &&
      !v.oauth_client_id
    ) {
      setError("请填写 Client ID");
      return;
    }
    let args = v.args || [];
    if (v.transport === "stdio") {
      try {
        args = JSON.parse(argsText);
        if (!Array.isArray(args) || args.some((x) => typeof x !== "string"))
          throw new Error();
      } catch {
        setError("stdio 参数必须是字符串数组");
        return;
      }
    }
    void d.save({
      args,
      auth_type: auth,
      headers: auth === "headers" ? headers : [],
      timeout_ms: Number(timeout),
      timeout: Number(timeout) / 1000,
    });
  }
  return (
    <Modal
      title={record ? "编辑 MCP Server" : "添加 MCP Server"}
      onClose={onClose}
      className="mcp-config-modal"
      footer={
        <>
          <button className="button secondary" onClick={onClose}>
            取 消
          </button>
          <button className="button primary" disabled={d.busy} onClick={save}>
            {d.busy ? "保存中…" : "确 定"}
          </button>
        </>
      }
    >
      <div className="parity-grid">
        <ConfigField title="名称 *">
          <input
            aria-label="名称"
            placeholder="例如：Git MCP"
            value={d.name}
            onChange={(e) => d.setName(e.target.value)}
          />
        </ConfigField>
        <ConfigField title="传输协议 *">
          <select
            aria-label="传输协议"
            value={v.transport}
            onChange={(e) => d.set("transport", e.target.value)}
          >
            <option value="streamable-http">Streamable HTTP</option>
            <option value="sse">SSE（兼容）</option>
            <option value="stdio">stdio（独立容器）</option>
          </select>
        </ConfigField>
        {v.transport === "stdio" ? (
          <>
            <ConfigField title="stdio 解释器">
              <select
                value={v.command}
                onChange={(e) => d.set("command", e.target.value)}
              >
                <option value="python">Python</option>
                <option value="node">Node.js</option>
              </select>
            </ConfigField>
            <ConfigField title="stdio 参数（JSON 数组）">
              <input
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
              />
            </ConfigField>
          </>
        ) : (
          <ConfigField title="Endpoint *" full>
            <input
              aria-label="Endpoint"
              placeholder="https://example.com/mcp 或 /sse"
              value={v.url || ""}
              onChange={(e) => d.set("url", e.target.value)}
            />
          </ConfigField>
        )}
        <fieldset className="parity-radio-group full">
          <legend>鉴权方式</legend>
          {[
            ["none", "无鉴权"],
            ["headers", "静态请求头"],
            ["oauth2", "OAuth 2.1"],
          ].map(([key, title]) => (
            <label key={key}>
              <input
                type="radio"
                name="mcp-auth"
                checked={auth === key}
                onChange={() => setAuth(key)}
              />
              {title}
            </label>
          ))}
        </fieldset>
        {auth === "headers" && (
          <div className="full parity-header-list">
            {headers.map((h, i) => (
              <div className="parity-header-row" key={i}>
                <input
                  aria-label={`Header 名称 ${i + 1}`}
                  placeholder="Header 名称"
                  value={h.name}
                  onChange={(e) =>
                    setHeaders(
                      headers.map((x, n) =>
                        n === i ? { ...x, name: e.target.value } : x,
                      ),
                    )
                  }
                />
                <input
                  aria-label={`Header 值 ${i + 1}`}
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    record?.configured_secrets?.includes(
                      "header:" + h.name.toLowerCase(),
                    ) || record?.configured_secrets?.includes("token")
                      ? "已配置，留空保留"
                      : "Header 值"
                  }
                  value={h.value}
                  onChange={(e) =>
                    setHeaders(
                      headers.map((x, n) =>
                        n === i ? { ...x, value: e.target.value } : x,
                      ),
                    )
                  }
                />
                <DeleteButton
                  aria-label={`删除请求头 ${h.name || i + 1}`}
                  onClick={() => setHeaders(headers.filter((_, n) => i !== n))}
                />
              </div>
            ))}
            <button
              className="button secondary"
              onClick={() => setHeaders([...headers, { name: "", value: "" }])}
            >
              <Plus size={14} />
              添加请求头
            </button>
          </div>
        )}
        {auth === "oauth2" && (
          <div className="full parity-oauth-fields">
            <fieldset className="parity-radio-group">
              <legend>客户端注册方式</legend>
              {[
                ["dynamic", "动态注册"],
                ["pre_registered", "预注册 Client"],
              ].map(([key, title]) => (
                <label key={key}>
                  <input
                    type="radio"
                    name="mcp-oauth-registration"
                    checked={(v.oauth_registration || "dynamic") === key}
                    onChange={() => d.set("oauth_registration", key)}
                  />
                  {title}
                </label>
              ))}
            </fieldset>
            {v.oauth_registration === "pre_registered" && (
              <>
                <ConfigField title="Client ID *">
                  <input
                    value={v.oauth_client_id || ""}
                    onChange={(e) => d.set("oauth_client_id", e.target.value)}
                  />
                </ConfigField>
                <ConfigField title="Client Secret">
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={v.oauth_client_secret || ""}
                    placeholder={
                      record?.configured_secrets?.includes(
                        "oauth_client_secret",
                      )
                        ? "已配置，留空保留"
                        : ""
                    }
                    onChange={(e) =>
                      d.set("oauth_client_secret", e.target.value)
                    }
                  />
                </ConfigField>
              </>
            )}
            <ConfigField title="Scopes">
              <input
                placeholder="用空格或逗号分隔"
                value={v.oauth_scopes || ""}
                onChange={(e) => d.set("oauth_scopes", e.target.value)}
              />
            </ConfigField>
          </div>
        )}
        <ConfigField title="工具调用超时（毫秒）">
          <input
            aria-label="工具调用超时（毫秒）"
            type="number"
            min={1000}
            max={600000}
            step={1000}
            value={timeout}
            onChange={(e) => setTimeout(Number(e.target.value))}
          />
        </ConfigField>
        <ConfigToggle
          title="启用状态"
          value={d.status === "active"}
          onChange={(x) => d.setStatus(x ? "active" : "disabled")}
        />
        <ConfigField title="描述" full>
          <textarea
            rows={3}
            value={v.description || ""}
            onChange={(e) => d.set("description", e.target.value)}
          />
        </ConfigField>
        {record && record.data.tools?.length > 0 && (
          <details className="full">
            <summary>工具访问权限（{record.data.tools.length}）</summary>
            {record.data.tools.map((t: any) => {
              const safe =
                  t.annotations?.readOnlyHint === true &&
                  t.annotations?.destructiveHint !== true,
                key = safe ? "allowed_tools" : "approved_write_tools";
              return (
                <ConfigToggle
                  key={t.name}
                  title={t.name}
                  hint={safe ? "只读查询" : "逐次审批后执行"}
                  value={(v[key] || []).includes(t.name)}
                  onChange={(yes) => {
                    d.set(
                      key,
                      yes
                        ? [...(v[key] || []), t.name]
                        : (v[key] || []).filter((n: string) => n !== t.name),
                    );
                    if (safe && yes) d.set("read_only_confirmed", true);
                  }}
                />
              );
            })}
          </details>
        )}
        {error && (
          <p role="alert" className="ref-notice full">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
