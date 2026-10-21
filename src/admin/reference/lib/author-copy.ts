/** Presentation only: never transform manuscripts, API identifiers, or saved data. */
export const authorStatuses: Record<string, string> = {
  candidate: "待你选择", draft: "草稿", confirmed: "已确认", partial: "尚未写完",
  queued: "排队中", running: "正在处理", waiting_author: "待你确认",
  succeeded: "已完成", completed: "已完成", failed: "未完成", cancelled: "已停止",
  stale: "内容有变化，请重新检查", paused_context: "参考内容需要调整",
  paused_budget: "本次剩余点数不足", paused_policy: "暂时无法继续",
  pending_reconciliation: "正在核对调用结果", insufficient: "资料不足，暂时无法判断",
  pass: "已检查，未发现问题", issue: "需要查看", waived: "保留原文",
  not_run: "尚未检查", disputed: "有不同意见", revoked: "已停用",
  chapter: "写一章", draft_generation: "写正文", review: "检查正文", memory: "整理故事记录",
  idea: "构思故事", planning: "整理大纲", world: "世界设定", characters: "人物设定",
  "chapter-plan": "安排本章情节", "plan-proposal": "调整近期大纲",
  "book-prepare": "准备人物和大纲", book_setup: "人物和近期大纲", idea_pressure: "后续剧情建议",
  "creation-stage":"整理创作资料",creation_document:"创作成果",creation_fragment:"已保留的片段",creation_source:"导入的原始资料",creation_character_registration:"待确认的人物卡",
  "preference-profile": "整理写作偏好", preference_profile: "写作偏好建议",
  "book-presentation": "准备书名和简介", book_presentation: "书名和简介建议",
  "prompt-suggestion": "整理写作要求", prompt_suggestion: "写作要求建议",
  "story-summary": "整理前情概括", story_summary: "前情概括", chapter_design: "本章写作安排",
  "rule-quality": "规则正反例检查", "review-calibration": "审稿模型校准", quality_report: "质量检查结果",
  "idea-pressure": "看看后面还能怎么写", "scene-simulation": "试演人物选择",
  "style-extract": "整理我的文风", "repair-loop": "按建议修改", "patch-recheck": "检查修改结果",
  "patch-proposal": "修改选中文字", branch_draft: "另一种写法", style_proposal: "文风建议",
  "knowledge-index": "整理参考资料", "knowledge-search": "查找参考资料",
  "story-index":"整理前文参考", "builtin-test":"测试助手", retrieval_report:"前文整理结果",
  simulated: "演示模式", character_knowledge: "人物知道的事", facts: "故事内容",
  transitions: "前后衔接", original_issues: "之前的问题", credits: "点",
};

export function authorLabel(value: unknown): string {
  const key=String(value ?? "");
  return authorStatuses[key] || ({active:"已启用",disabled:"已停用",pending:"待处理",approved:"已通过",archived:"历史版本",writing:"写作中",purchase:"充值",consume:"使用",refund:"退还",reserve:"暂时预留",release:"退回预留",generation:"生成内容",manual_adjust:"额度调整",agent:"写作助手",sent:"已发送",delivered:"已送达",paid:"已付款",refunded:"已退款",none:"未设置"} as Record<string,string>)[key] || (/^[\w.-]+$/.test(key) ? "待查看" : key);
}

export function authorError(message: string, status = 0): string {
  if(status===401) return "登录已过期，请重新登录。";
  if(status===403) return "你暂时无法进行这项操作。";
  if(status>=500) return "暂时处理失败，已保存的内容仍在，请稍后再试。";
  if(/SQL|Traceback|ValidationError|Input should|Field required|UUID|JSON|schema|relation .* does not exist|column .* does not exist/i.test(message))
    return "有些内容暂时无法处理，请检查填写内容后重试。";
  return message.replaceAll("正史", "故事记录").replaceAll("创作合同", "本书设定")
    .replaceAll("候选记忆", "本章新增记录").replaceAll("认知命题", "人物知道的事")
    .replaceAll("上下文", "参考内容").replaceAll("幂等键", "提交内容")
    .replaceAll("哈希", "版本").replaceAll("候选", "新内容").replaceAll("节点", "步骤")
    .replaceAll("算力", "点").replaceAll("Token", "内容长度");
}

export type AuthorProblem = { message: string; fields: string[]; action: { label: string; href?: string; focus?: boolean } };
export function authorProblem(data: any, status: number, pathname: string): AuthorProblem {
  const code = data.code || data.error_code || "", fields: string[] = Array.isArray(data.fields) ? data.fields : [];
  const book = pathname.match(/^\/studio\/book\/([^/]+)/)?.[1];
  const preparing = !!book && data.kind === "book-prepare";
  const labels: Record<string,string> = { title:"作品名称", name:"名称", instruction:"写作要求", budget:"本次用量上限", budget_limit:"作品用量上限", model:"模型", chapter:"章节", reason:"原因", text:"正文", content:"内容", hours:"授权时间", admin_id:"协助人员" };
  const missing = [...new Set(fields.map(f => labels[f.split('.').at(-1) || ""]).filter(Boolean))];
  const actions: Record<string,AuthorProblem['action']> = {
    sign_in_required:{label:"重新登录",href:"/studio"},
    budget_required:{label:"调整用量上限",href:book ? `/studio/works?edit=${encodeURIComponent(book)}` : "/studio/settings"},
    project_budget_required:{label:"查看作品总额度",href:book ? `/studio/works?edit=${encodeURIComponent(book)}` : "/studio/works"},
    balance_required:{label:"查看点数与用量",href:"/studio/activity"},
    assistant_budget_limit:{label:"调整本次用量",href:book ? `/studio/book/${book}/draft#writing-options` : "/studio/activity"},
    run_budget_required:{label:"查看进度并继续",href:book ? `/studio/book/${book}/draft#writing-options` : "/studio/activity"},
    service_unavailable:{label:"选择可用模型",href:book ? `/studio/book/${book}/draft#writing-options` : "/studio/settings"},
    reference_limit:{label:"调整模型与参考范围",href:book ? `/studio/book/${book}/draft#writing-options` : "/studio/works"},
    model_window_unconfigured:{label:"选择其他可用模型",href:book ? `/studio/book/${book}/draft#writing-options` : "/studio/settings"},
    request_rate_limit:{label:"调整模型与参考范围",href:book ? `/studio/book/${book}/draft#writing-options` : "/studio/settings"},
    acceptance_unknown:{label:"查看任务与费用",href:"/studio/activity"},
    personal_api_connection:{label:"检查 API 配置",href:"/studio/settings"},
    personal_api_timeout:{label:"检查 API 配置",href:"/studio/settings"},
    personal_api_response:{label:"检查 API 配置",href:"/studio/settings"},
    version_changed:{label:"查看当前版本",href:book ? `/studio/book/${book}/draft` : "/studio/activity"},
    access_denied:{label:"查看协助方式",href:"/studio/help"},
    prerequisite_missing:{label:"补全本书资料",href:book ? `/studio/book/${book}/contract` : "/studio/works"},
    invalid_input:{label:"检查填写内容",focus:true},
    protected_text:{label:"重新选择修改范围",href:book ? `/studio/book/${book}/draft` : "/studio/works"},
    edit_scope:{label:"重新选择修改范围",href:book ? `/studio/book/${book}/draft` : "/studio/works"},
    overlapping_edits:{label:"返回正文分段修改",href:book ? `/studio/book/${book}/draft` : "/studio/works"},
    edit_ratio_limit:{label:"调整修改范围",href:book ? `/studio/book/${book}/draft` : "/studio/works"},
    not_found:{label:"返回我的作品",href:"/studio/works"},
  };
  const contextMessages: Record<string,string> = {
    reference_limit:"本次参考内容太多，请减少参考范围、分场景写作或选择容量更大的模型。已保存的内容仍保留。",
    model_window_unconfigured:"这个模型尚未设置可处理的内容长度，请选择其他可用模型，或联系管理员补全模型设置。",
    request_rate_limit:"本次请求超过模型每分钟上限，请减少参考内容或联系管理员调整上限。已保存的内容仍保留。",
  };
  if (preparing) {
    for (const key of ["reference_limit", "model_window_unconfigured", "request_rate_limit"])
      actions[key] = {label:"返回人物和大纲",href:`/studio/book/${book}/setup`};
    contextMessages.reference_limit = "准备人物和大纲时，读取的资料超出了本次容量。已有作品资料仍保留。";
  }
  const personalMessages: Record<string,string> = {
    personal_api_connection:"个人 API 连接失败或拒绝请求，请检查 API 配置与服务商额度。",
    personal_api_timeout:"个人 API 调用超时，服务商可能已计费；请核对后再手动重试。",
    personal_api_response:"个人 API 拒绝请求或响应不完整，请检查接口协议、模型和密钥；已受理请求可能产生服务商费用。",
  };
  return {message:personalMessages[code] || contextMessages[code] || (missing.length ? `请检查：${missing.join('、')}。` : authorError(data.message || data.detail || "暂时未能完成，请稍后再试",status)),fields,
    action:actions[code] || {label:"查看任务状态",href:"/studio/activity"}};
}
