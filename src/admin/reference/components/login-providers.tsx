"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Pencil } from "lucide-react";
import { api, put, post } from "@reference/lib/api";
import { Modal } from "./reference-ui";
import { Spinner, ErrorState, Status, useToast } from "./ui";

const blank = {
  name: "",
  enabled: false,
  mode: "sandbox",
  allow_registration: false,
  client_id: "",
  client_secret: "",
  authorization_url: "",
  token_url: "",
  userinfo_url: "",
  scope: "",
  subject_field: "sub",
  name_field: "name",
  pkce: true,
  issuer: "",
  jwks_url: "",
  notification_config_id: "",
  expected_version: 0,
};
export function LoginProviders({
  onAccount,
  accountEnabled = true,
}: {
  onAccount: () => void;
  accountEnabled?: boolean;
}) {
  const q = useQuery({
      queryKey: ["login-providers"],
      queryFn: () => api("/admin/login-providers"),
    }),
    configs = useQuery({
      queryKey: ["notification-configs"],
      queryFn: () => api("/admin/records/notifications?page_size=200"),
    }),
    toast = useToast();
  const [edit, setEdit] = useState<any>(null),
    [busy, setBusy] = useState(false);
  if (q.isPending) return <Spinner />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <>
      <h1 className="ref-config-title">登录方式配置</h1>
      <div className="ref-setting-cards four">
        <section className="ref-setting-tile">
          <header>
            <KeyRound size={18} />
            <h2>账号登录</h2>
            <button
              className="icon-button"
              aria-label="配置账号登录"
              onClick={onAccount}
            >
              <Pencil size={14} />
            </button>
          </header>
          <div>
            <Status value={accountEnabled ? "active" : "disabled"} />
            <p>管理密码登录、开放注册及会话期限。</p>
          </div>
        </section>
        {q.data.items.map((r: any) => (
          <section className="ref-setting-tile" key={r.key}>
            <header>
              <KeyRound size={18} />
              <h2>{r.name}</h2>
              <button
                className="icon-button"
                aria-label={`配置${r.name}`}
                onClick={() => {
                  const form: any = { ...blank };
                  Object.keys(blank).forEach((k) => {
                    if (k in r) form[k] = r[k];
                  });
                  setEdit({
                    key: r.key,
                    callback: r.callback_url,
                    secret: r.secret_configured,
                    form: { ...form, expected_version: r.version },
                  });
                }}
              >
                <Pencil size={14} />
              </button>
            </header>
            <div>
              <div className="ref-switch-row">
                <span>启用状态</span>
                <Status value={r.enabled ? "active" : "disabled"} />
              </div>
              <p>
                {r.mode === "live"
                  ? "正式配置，仍受系统外部模式约束"
                  : "沙箱配置"}
              </p>
              <small>
                {["email", "sms"].includes(r.key)
                  ? "验证码验证与账号绑定"
                  : "授权码登录与账号绑定"}
              </small>
            </div>
          </section>
        ))}
      </div>
      {edit && (
        <Modal
          title={`配置${edit.form.name}`}
          onClose={() => setEdit(null)}
          wide
          footer={
            <button
              className="button primary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await put(`/admin/login-providers/${edit.key}`, edit.form);
                  await q.refetch();
                  setEdit(null);
                  toast("登录渠道已保存");
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              保存配置
            </button>
          }
        >
          <div className="ref-form two-columns">
            <label className="field">
              显示名称
              <input
                value={edit.form.name}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    form: { ...edit.form, name: e.target.value },
                  })
                }
              />
            </label>
            <label className="field">
              运行环境
              <select
                value={edit.form.mode}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    form: { ...edit.form, mode: e.target.value },
                  })
                }
              >
                <option value="sandbox">沙箱配置</option>
                <option value="live">正式配置</option>
              </select>
            </label>
          </div>
          <div className="ref-toolbar">
            {[
              ["enabled", "启用渠道"],
              ["allow_registration", "允许创建作者账号"],
            ].map(([k, n]) => (
              <label key={k}>
                <input
                  type="checkbox"
                  checked={edit.form[k]}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      form: { ...edit.form, [k]: e.target.checked },
                    })
                  }
                />
                {n}
              </label>
            ))}
          </div>
          <p className="ref-field-help">
            创建新账号还需要站点开放注册及用户同意条款。已有账号通过个人设置主动绑定；同名邮箱不会自动合并账号。
          </p>
          {["email", "sms"].includes(edit.key) ? (
            <label className="field">
              邮件 / 短信通知通道
              <select
                value={edit.form.notification_config_id}
                onChange={(e) =>
                  setEdit({
                    ...edit,
                    form: {
                      ...edit.form,
                      notification_config_id: e.target.value,
                    },
                  })
                }
              >
                <option value="">选择已配置通道</option>
                {configs.data?.items.map((r: any) => (
                  <option value={r.id} key={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="field">
                回调地址
                <input readOnly value={edit.callback} />
              </label>
              <div className="ref-form two-columns">
                {[
                  ["client_id", "Client ID / AppID"],
                  ["client_secret", "Client Secret / AppSecret"],
                  ["authorization_url", "授权地址"],
                  ["token_url", "访问令牌地址"],
                  ["userinfo_url", "用户信息地址"],
                  ["scope", "授权范围"],
                  ["subject_field", "用户唯一标识字段"],
                  ["name_field", "昵称字段"],
                  ["issuer", "ID Token 签发者（可选）"],
                  ["jwks_url", "JWKS 地址（可选）"],
                ].map(([k, n]) => (
                  <label className="field" key={k}>
                    {n}
                    <input
                      type={k === "client_secret" ? "password" : "text"}
                      autoComplete="off"
                      value={edit.form[k]}
                      placeholder={
                        k === "client_secret" && edit.secret
                          ? "已配置，留空保留"
                          : ""
                      }
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          form: { ...edit.form, [k]: e.target.value },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={edit.form.pkce}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      form: { ...edit.form, pkce: e.target.checked },
                    })
                  }
                />{" "}
                使用 PKCE S256（需身份平台支持）
              </label>
              <p className="ref-field-help">
                预设依据公开协议建立，具体应用权限、回调白名单和平台审核仍须在对应平台配置并联调。
              </p>
            </>
          )}
        </Modal>
      )}
    </>
  );
}

export function ExternalLoginOptions({
  linking = false,
  destination = "/studio",
}: {
  linking?: boolean;
  destination?: string;
}) {
  const q = useQuery({
      queryKey: ["auth-options"],
      queryFn: () => api("/auth/options"),
    }),
    bound = useQuery({
      queryKey: ["auth-identities"],
      queryFn: () => api("/auth/identities"),
      enabled: linking,
    }),
    cache = useQueryClient(),
    toast = useToast();
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [otp, setOtp] = useState<any>(null),
    [address, setAddress] = useState(""),
    [code, setCode] = useState("");
  async function begin(provider: any) {
    if (["email", "sms"].includes(provider.key)) {
      setOtp({ provider });
      setAddress("");
      setCode("");
      return;
    }
    setBusy(true);
    try {
      const r = await post(
        `/auth/providers/${provider.key}/${linking ? "link" : "start"}`,
        { consent, destination },
      );
      window.location.assign(r.url);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  if (q.error) return <ErrorState error={q.error} />;
  if (!q.data?.providers.length && !linking) return null;
  return (
    <div className="external-login-options">
      {linking && (
        <>
          <h3>第三方账号绑定</h3>
          <p>
            {bound.data?.items.length
              ? bound.data.items.map((r: any) => r.name).join(" · ")
              : "尚未绑定第三方身份"}
          </p>
        </>
      )}
      {!linking && q.data?.registration && (
        <label>
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />{" "}
          首次使用第三方登录时，我同意按站点条款创建作者账号。
        </label>
      )}
      <div className="ref-toolbar">
        {q.data?.providers.map((p: any) => (
          <button
            type="button"
            className="button secondary"
            disabled={busy || !p.available}
            title={p.available ? "" : "该渠道仍处于沙箱配置"}
            key={p.key}
            onClick={() => begin(p)}
          >
            {linking ? "绑定" : ""}
            {p.name}
            {!p.available ? " · 沙箱" : ""}
          </button>
        ))}
      </div>
      {linking && !q.data?.providers.length && (
        <p className="muted">管理员尚未启用其他登录渠道。</p>
      )}
      {otp && (
        <Modal
          title={otp.provider.name}
          onClose={() => setOtp(null)}
          footer={
            <button
              type="button"
              className="button primary"
              disabled={busy || !otp.challenge_id || !/^[0-9]{6}$/.test(code)}
              onClick={async () => {
                setBusy(true);
                try {
                  await post("/auth/otp/verify", {
                    challenge_id: otp.challenge_id,
                    code,
                  });
                  await cache.invalidateQueries();
                  setOtp(null);
                  toast(linking ? "身份已绑定" : "登录成功");
                } catch (e) {
                  toast((e as Error).message, true);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {linking ? "验证并绑定" : "验证并登录"}
            </button>
          }
        >
          <label className="field">
            {otp.provider.key === "email" ? "邮箱" : "手机号"}
            <input
              type={otp.provider.key === "email" ? "email" : "tel"}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              disabled={!!otp.challenge_id}
            />
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={busy || !address || !!otp.challenge_id}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await post(
                  `/auth/providers/${otp.provider.key}/otp`,
                  { address, consent, link: linking },
                );
                setOtp({ ...otp, ...r });
                toast("验证码已发送，5 分钟内有效");
              } catch (e) {
                toast((e as Error).message, true);
              } finally {
                setBusy(false);
              }
            }}
          >
            发送验证码
          </button>
          <label className="field">
            验证码
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        </Modal>
      )}
    </div>
  );
}

export function AuthorAuthentication() {
  const q = useQuery({
      queryKey: ["auth-options"],
      queryFn: () => api("/auth/options"),
    }),
    config = useQuery({
      queryKey: ["public-config"],
      queryFn: () => api("/public/config"),
    }),
    toast = useToast(),
    cache = useQueryClient();
  const [register, setRegister] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await post(register ? "/auth/register" : "/auth/login", {
            username,
            password,
            ...(register ? { terms_accepted: consent } : {}),
          });
          await cache.invalidateQueries();
        } catch (error) {
          toast((error as Error).message, true);
        } finally {
          setBusy(false);
        }
      }}
    >
      <span className="s-kicker">你的私人创作空间</span>
      <h2>{register ? "开始你的故事。" : "继续你的故事。"}</h2>
      <p>
        {register
          ? "注册独立作者账号，作品默认仅对你开放。"
          : "登录后继续写作，作品默认仅对你开放。"}
      </p>
      {(q.data?.password_login !== false || register) && (
        <>
          <label>
            账号
            <input
              autoComplete="username"
              required
              minLength={register ? 3 : 2}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              required
              minLength={register ? 10 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {register && (
            <label>
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />{" "}
              我已阅读并同意服务条款和隐私政策
            </label>
          )}
          <button
            className="s-btn primary"
            disabled={busy || (register && !consent)}
          >
            {busy ? "请稍候…" : register ? "注册并进入" : "进入创作空间"}
          </button>
        </>
      )}
      {q.data?.registration && (
        <button
          type="button"
          className="text-button"
          onClick={() => setRegister(!register)}
        >
          {register ? "已有账号，前往登录" : "创建作者账号"}
        </button>
      )}
      <ExternalLoginOptions />
      {(config.data?.display?.terms || config.data?.display?.privacy) && (
        <details>
          <summary>服务条款与隐私政策</summary>
          <pre
            style={{ whiteSpace: "pre-wrap", maxHeight: 220, overflow: "auto" }}
          >
            {config.data.display.terms}
            {"\n\n"}
            {config.data.display.privacy}
          </pre>
        </details>
      )}
    </form>
  );
}
