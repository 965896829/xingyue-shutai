// Explicit page definitions transcribed from the reference UI on 2026-09-19.
// Empty fields render as an em dash; reference-site records are never imported.
export type RefColumn = { key: string; title: string; type?: string };
export type RefFilter = {
  key: string;
  label: string;
  options?: string[];
  type?: string;
};
export type RefPage = {
  title?: string;
  description?: string;
  columns: RefColumn[];
  filters?: RefFilter[];
  search?: string;
  create?: string;
  size?: number;
  select?: boolean;
  notice?: string;
  export?: boolean;
};
const cols = (text: string): RefColumn[] =>
  text.split("|").map((s) => {
    const [key, title, type] = s.split(":");
    return { key, title, type };
  });
const status: RefFilter = {
  key: "status",
  label: "全部状态",
  options: ["active", "disabled", "draft"],
};
export const referencePages: Record<string, RefPage> = {
  mcp: {
    title: "MCP Server 管理",
    description: "管理共享的 SSE 与 Streamable HTTP MCP 接入、授权和工具快照",
    create: "添加 MCP Server",
    columns: cols(
      "name:Server:identity|transport:传输|auth_type:鉴权|last_probe:状态|tool_count:工具|status:启用:status",
    ),
    size: 20,
  },
  pricing: {
    search: "搜索规则名称 / Key / 资源类型",
    filters: [
      {
        key: "resource_type",
        label: "全部分类",
        options: ["text", "image", "video", "audio", "embedding", "rerank"],
      },
      status,
    ],
    create: "新增规则",
    select: true,
    size: 10,
    columns: cols(
      "name:规则:identity|pricing_summary:计价摘要|resource_type:分类|status:状态:status|currency:币种|entry_count:条目|description:说明",
    ),
  },
  "runtime-policies": {
    search: "搜索策略名称 / 描述 / 指标",
    filters: [status],
    create: "新增策略",
    select: true,
    size: 10,
    columns: cols(
      "name:策略:identity|rpm:RPM|tpm:TPM|concurrency:并发|strategy:策略摘要|status:状态:status",
    ),
  },
  platforms: {
    search: "搜索平台 / 模型 / Base URL",
    filters: [{ key: "provider", label: "全部厂商" }],
    create: "新增平台",
    select: true,
    size: 10,
    columns: cols(
      "name:平台:identity|provider:厂商|models:模型|status:状态:status|balance:余额|priority:优先级|pricing_id:计费|runtime_policy_id:运行策略|access_summary:权限预览|created_at:创建时间:date|updated_at:更新时间:date",
    ),
  },
  "access-rules": {
    title: "权限规则",
    description: "统一维护平台、平台模型、基础模型的 allow / deny 访问规则。",
    search: "搜索资源 / 主体 / 来源",
    filters: [
      { key: "resource", label: "全部资源" },
      { key: "effect", label: "全部效果", options: ["allow", "deny"] },
    ],
    create: "新增规则",
    columns: cols(
      "resource:资源|principal:主体|effect:效果|minimum_level:最低等级|priority:优先级|source:来源|updated_at:更新时间:date",
    ),
  },
  "chat-audits": {
    title: "大模型请求日志",
    description: "生图、视频类任务在生成历史中查看。",
    filters: [
      { key: "id", label: "Request ID" },
      { key: "upstream_request_id", label: "上游请求 ID" },
      { key: "user_id", label: "User ID" },
      { key: "conversation_id", label: "Conversation ID" },
      { key: "session_id", label: "Session ID" },
    ],
    size: 50,
    columns: cols(
      "id:Request ID|status:状态 / 重试:status|model:模型|platform_id:平台|token_usage:用量|latency_ms:响应时间|stream:流式|conversation_id:Conversation|session_id:Session|created_at:开始时间:date|updated_at:结束时间:date",
    ),
  },
  cloud: {
    create: "添加新平台",
    columns: cols(
      "index:序号|name:名称|provider:平台|priority:优先级|features:启用的功能|status:状态:status",
    ),
  },
  products: {
    create: "新增套餐",
    size: 10,
    columns: cols(
      "sort:排序|name:名称|price:金额(分)|currency:货币|virtual_item_id:微信虚拟道具 ID|credits:算力额度|bonus:赠送算力|duration_days:算力有效期(天)|membership_days:会员时长|organization:组织|package_type:套餐类型|billing_mode:计费方式|renewal_days:续费周期|online_pay:启用线上充值:boolean|redeem_enabled:启用兑换码:boolean|description:描述|cover:封面|applications:关联应用",
    ),
  },
  subscriptions: {
    title: "订阅记录",
    description:
      "查询用户订阅、签约、账期、扣款和权益发放情况，并查看完整处理记录。",
    search: "按用户名、昵称或手机号搜索",
    filters: [
      {
        ...status,
        label: "订阅状态",
        options: ["active", "cancelled", "expired"],
      },
    ],
    export: true,
    columns: cols(
      "id:订阅 ID|user_id:用户|product_id:订阅套餐|status:状态:status|period:当前账期|next_charge:下次扣款:date|stop_at:计划停止:date",
    ),
  },
  orders: {
    filters: [
      {
        key: "invoice_status",
        label: "开票状态筛选",
        options: ["none", "requested", "issued"],
      },
    ],
    export: true,
    select: true,
    size: 20,
    columns: cols(
      "user_id:昵称/账号|id:订单编号|product_id:套餐名称|amount:订单金额:money|status:支付状态:status|created_at:订单创建时间:date|paid_at:支付时间:date|payment_provider:支付平台|payer_id:平台付款用户ID|invoice_status:开票状态",
    ),
  },
  "redeem-codes": {
    create: "新增兑换码",
    search: "兑换码 / 描述",
    filters: [
      { key: "user_id", label: "用户ID / 用户名 / 昵称 / 邮箱" },
      { key: "redeemed_from", label: "兑换开始时间", type: "datetime-local" },
      { key: "redeemed_to", label: "兑换结束时间", type: "datetime-local" },
      { key: "type", label: "兑换码类型", options: ["credits", "product"] },
    ],
    export: true,
    size: 20,
    columns: cols(
      "id:ID|code:兑换码|status:是否有效:status|uses:兑换历史|description:描述|credits:算力|activated:是否激活:boolean|max_uses:可兑换|use_count:已兑换|expires_at:过期时间:date|type:类型|product_id:资源包产品",
    ),
  },
  "resource-packs": {
    filters: [
      {
        ...status,
        options: ["active", "disabled", "expired", "expiring", "revoked"],
      },
      { key: "user_id", label: "按用户筛选（ID/用户名/昵称/手机/邮箱）" },
      { key: "organization", label: "按组织筛选" },
      { key: "source", label: "按来源筛选" },
    ],
    export: true,
    size: 20,
    columns: cols(
      "id:ID|user_id:用户|organization:组织|package_type:资源包类型|source:来源类型|name:来源名称|order_id:来源ID|total:套餐数量|bonus:赠送数量|remaining:套餐剩余|bonus_remaining:赠送剩余|remaining_total:总剩余|status:状态:status|starts_at:生效时间:date|expires_at:过期时间:date|created_at:创建时间:date",
    ),
  },
  members: {
    notice:
      "会员通过关联套餐发放权益。组织成员与会员资格分别管理；手动添加会员时请核对生效时间、到期时间与权限等级。",
    create: "手动添加会员",
    columns: cols(
      "user_id:用户名|name:会员名称|level:等级权限|created_at:创建时间:date|starts_at:生效时间:date|expires_at:过期时间:date|duration_days:会员有效期|organization:组织名称|product_id:套餐名称|product_details:套餐详情|resource_pack_id:资源包ID",
    ),
  },
  expenses: {
    search: "搜索用户/应用/平台",
    filters: [
      { key: "reference", label: "历史记录 ID（精确检索）" },
      { key: "created_from", label: "开始日期", type: "date" },
      { key: "created_to", label: "结束日期", type: "date" },
      {
        key: "kind",
        label: "消费类型",
        options: [
          "purchase",
          "consume",
          "manual_adjust",
          "refund",
          "reserve",
          "release",
        ],
      },
      { key: "source", label: "请求来源" },
      { key: "resource_pack", label: "资源包ID/名称" },
    ],
    export: true,
    size: 15,
    columns: cols(
      "user_id:用户信息|organization:组织|reference:历史记录 ID|kind:消费类型|billing_mode:计费模式|source:请求来源|api_key_name:API Key 名称|api_key_id:API Key ID|deduction_source:扣费来源|resource_pack_id:资源包ID|resource_pack_name:资源包名称|amount:算力消耗|token_usage:token消耗|balance_after:当前余额|application:应用|platform:平台|model:模型|parameters:生成参数|created_at:创建时间:date|started_at:开始时间:date|ended_at:结束时间:date",
    ),
  },
  users: {
    search: "搜索用户名/昵称/手机/邮箱",
    filters: [
      { key: "organization", label: "按组织架构筛选" },
      {
        key: "role",
        label: "按角色筛选",
        options: [
          "author",
          "creator",
          "operator",
          "manager",
          "superadmin",
          "evaluator",
        ],
      },
    ],
    create: "新增用户",
    export: true,
    size: 20,
    columns: cols(
      "avatar:头像:avatar|username:用户名|nickname:昵称|role:角色|organization:组织|status:用户状态:status|email:邮箱|phone:手机|balance:余额|last_login_at:上次登录:date|last_login_ip:上次登录IP|inviter_id:邀请者|created_at:注册日期:date|wecom_id:企业微信ID|feishu_open_id:飞书open_id|feishu_union_id:飞书union_id|wechat_open_id:微信openid|wechat_union_id:微信unionid",
    ),
  },
  "desktop-skills": {
    title: "桌面技能商店中心",
    description: "管理桌面端 Skill Store 的分类、版本审核、上架和下架。",
    search: "搜索技能名称、标题或描述",
    filters: [
      {
        ...status,
        options: ["pending_review", "approved", "rejected", "unlisted"],
      },
      { key: "category", label: "全部分类" },
    ],
    create: "上传 ZIP",
    columns: cols(
      "name:技能:identity|category:分类|source:来源|status:状态:status|user_id:用户|device_id:设备ID|version:版本|downloads:下载",
    ),
  },
  "desktop-devices": {
    search: "用户名 / 邮箱 / 手机号 / 设备编码",
    filters: [
      { key: "organization", label: "组织" },
      { key: "device_id", label: "客户端类型 / ID" },
      { key: "client_version", label: "客户端版本" },
    ],
    size: 20,
    columns: cols(
      "user_id:用户|organization:组织|client_type:客户端类型|device_id:客户端 ID|client_version:客户端版本|last_login:最近登录时间:date|device_code:客户端唯一编码|os:系统|session_id:最近会话|updated_at:最近刷新时间:date|status:状态:status",
    ),
  },
  income: {
    columns: cols(
      "user_id:用户信息|total_income:累计充值分成:money|settled_income:已结算:money|unsettled_income:未结算:money|credits_income:累计积分收益|settled_credits:已结算|unsettled_credits:未结算",
    ),
  },
  withdrawals: {
    columns: cols(
      "created_at:创建时间:date|user_id:用户信息|amount:提现金额:money|status:状态:status|proof:交易凭证|remark:备注",
    ),
  },
  audit: {
    title: "审计中心",
    description: "登录与身份事件、人工余额及权益操作可按条件追溯。",
    filters: [
      { key: "action", label: "事件类型" },
      {
        key: "status",
        label: "结果",
        options: ["success", "failed", "denied"],
      },
      { key: "actor_id", label: "操作人 ID" },
      { key: "target_id", label: "目标用户 ID" },
      { key: "request_id", label: "Request ID" },
      { key: "ip", label: "IP" },
      { key: "device_hash", label: "设备/指纹哈希" },
      { key: "resource", label: "业务记录 ID" },
      { key: "created_from", label: "开始时间", type: "datetime-local" },
      { key: "created_to", label: "结束时间", type: "datetime-local" },
    ],
    export: true,
    size: 20,
    columns: cols(
      "created_at:时间:date|action:类型|status:结果:status|actor_id:操作人|resource:目标|stage:阶段|failure_reason:失败原因|ip:IP|device_hash:设备哈希|request_id:Request ID",
    ),
  },
  notifications: {
    filters: [
      {
        key: "event",
        label: "事件分类",
        options: [
          "run.failed",
          "run.completed",
          "budget.low",
          "order.paid",
          "backup.failed",
        ],
      },
      status,
    ],
    create: "新增规则",
    size: 20,
    columns: cols(
      "event:事件类型|name:事件名称|source:来源|category:分类|status:状态:status|channel_im:IM|channel_email:邮件|channel_sms:短信|channel_in_app:站内|channel_governance:治理|updated_at:更新时间:date",
    ),
  },
};
