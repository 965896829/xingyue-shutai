import { referenceRequest } from "../../reference-api";
export { authorLabel } from "./author-copy";
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "",
    public fields: string[] = [],
    public retryable = false,
    public traceId = "",
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  options: RequestInit & { suppressErrorNotice?: boolean; taskApproved?: boolean } = {},
): Promise<T> {
  return referenceRequest(path, options) as Promise<T>;
}

export const post = <T = any>(path: string, body: unknown = {}, options: { taskApproved?: boolean } = {}) =>
  api<T>(path, { ...options, method: "POST", body: JSON.stringify(body) });
export const put = <T = any>(path: string, body: unknown) =>
  api<T>(path, { method: "PUT", body: JSON.stringify(body) });
export const formatNumber = (n: number | undefined) =>
  new Intl.NumberFormat("zh-CN").format(n || 0);
export const formatTime = (v: string | undefined) =>
  v
    ? new Date(v).toLocaleString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
    : "—";
export type Field = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  options: string[];
  default: any;
};
export type PageSpec = {
  key: string;
  group: string;
  label: string;
  path: string;
  description: string;
  fields: Field[];
  view: string;
  actions: string[];
};
export type Group = {
  key: string;
  label: string;
  source_label: string;
  icon: string;
};
export type Catalog = { groups: Group[]; pages: PageSpec[] };
export type DataRecord = {
  id: string;
  name: string;
  status: string;
  data: Record<string, any>;
  version: number;
  created_at: string;
  configured_secrets?: string[];
  [key: string]: any;
};
export async function recordCollection(kind: string) {
  const items: DataRecord[] = [];
  for (let page = 1; ; page++) {
    const batch = await api<{ items: DataRecord[]; total: number }>(
      `/admin/records/${kind}?page_size=200&page=${page}`,
    );
    items.push(...batch.items);
    if (!batch.items.length || items.length >= batch.total)
      return { items, total: items.length };
  }
}
export const statusLabels: Record<string, string> = {
  "creation-stage":"创作阶段任务",creation_document:"创作成果",creation_fragment:"已保留的片段",creation_source:"导入资料",creation_character_registration:"人物卡整理结果",
  "repair-loop": "有界修复",
  "patch-recheck": "修改后局部复查",
  patch_recheck: "局部复查报告",
  repair_round: "修复过程候选",
  branch_draft: "分支试写",
  "knowledge-index": "知识语义索引",
  "knowledge-search": "知识检索",
  character_knowledge: "人物认知",
  facts: "事实保持",
  transitions: "前后衔接",
  original_issues: "原问题处理",
  pass: "检查通过",
  issue: "发现问题",
  insufficient: "证据不足",
  disputed: "存在争议",
  waived: "作者保留",
  delivered: "已受理",
  sending: "发送中",
  delivery_unknown: "受理待核对",
  simulated: "沙箱已验证",
  refunding: "退款处理中",
  pending_confirmation: "等待渠道确认",
  success: "成功",
  denied: "已拒绝",
  allow: "允许",
  deny: "拒绝",
  priority: "按优先级",
  round_robin: "轮询",
  least_load: "较低负载",
  none: "未设置",
  requested: "申请中",
  issued: "已开票",
  credits: "算力",
  product: "套餐",
  purchase: "充值",
  consume: "消耗",
  generation: "生成扣费",
  manual_adjust: "人工调整",
  refund: "退款",
  reserve: "预留",
  release: "释放预留",
  creative: "创作布局",
  classic: "经典布局",
  top: "顶部",
  center: "居中",
  bottom: "底部",
  personal: "个人",
  organization: "组织",
  "run.failed": "任务失败",
  "run.completed": "任务完成",
  "budget.low": "余额不足",
  "order.paid": "订单支付成功",
  "backup.failed": "备份失败",
  active: "已启用",
  disabled: "已停用",
  draft: "草稿",
  pending: "待处理",
  pending_review: "待审核",
  approved: "已通过",
  rejected: "已拒绝",
  paid: "已支付",
  refunded: "已退款",
  cancelled: "已取消",
  completed: "已完成",
  succeeded: "已完成",
  failed: "失败",
  running: "进行中",
  queued: "排队中",
  expired: "已到期",
  expiring: "到期结算中",
  waiting_author: "等待作者确认",
  pending_reconciliation: "待核对",
  paused_context: "参考内容需要调整",
  paused_policy: "策略暂停",
  paused_budget: "预算暂停",
  stale: "需要复核",
  settled: "已结算",
  revoked: "已撤销",
  unlisted: "已下架",
  archived: "历史版本",
  unread: "未读",
  read: "已读",
  planning: "策划中",
  writing: "创作中",
  confirmed: "已确认",
  candidate: "候选",
  superadmin: "超级管理员",
  manager: "管理员",
  operator: "运营人员",
  evaluator: "评测人员",
  author: "作者",
  creator: "创作者",
  "style-extract": "提取风格",
  style_proposal: "风格提案",
  "idea-pressure": "创意压力测试",
  idea_pressure: "压力测试",
  "patch-proposal": "修订提案",
  patch_proposal: "修订提案",
  "scene-simulation": "场景模拟",
  scene_simulation: "场景模拟",
  scene_choice: "行动意图",
  idea: "灵感",
  review: "审稿",
  memory: "记忆",
  patch: "修订",
  partial: "未完成片段",
  world: "世界观",
  characters: "人物与关系",
  "chapter-plan": "章节规划",
  "plan-proposal": "近期规划提案",
  plan_proposal: "近期规划提案",
  chapter: "生成与审稿",
  agent: "助手对话",
  text: "文本",
  embedding: "嵌入",
  image: "图像",
  video: "视频",
  audio: "音频",
  rerank: "重排",
  sandbox: "沙箱",
  live: "正式",
  private: "私人",
  platform: "平台",
  project: "作品",
  one_time: "单次购买",
  subscription: "订阅",
};
export function label(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "是" : "否";
  if (Array.isArray(v)) return v.map(label).join(" / ");
  if (typeof v === "object") return JSON.stringify(v);
  return statusLabels[String(v)] || String(v);
}
