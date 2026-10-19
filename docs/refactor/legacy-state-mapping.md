# 旧状态与恢复映射

保留旧 Run.status 供既有 UI 和旧数据读取，数据库 saveRun 验证统一转换与 stateVersion。stateVersion 表示状态转换版本，候选内容另由指纹验证。

| 旧 Run 状态 | 执行/候选含义 | 可用恢复 |
|---|---|---|
| running | 一次执行进行中 | 重开后 parked/remote_unknown，不自动推理 |
| paused | 已停靠 | 显式继续创建后继执行 |
| unknown | 上次远端结果未知 | 查看已保存结果、本地重核；明确授权才重发 |
| awaiting_input / awaiting_permission | 等待作者控制 | 回答/拒绝/明确授权；工具权限仍再检查 |
| awaiting_review / needs_repair | 生成有可审阅候选 | 生成执行结束；候选尚未正式归属 |
| stale | 来源或版本变化 | 重新核对，旧审批不复用 |
| committing | 本地提交阶段 | 按 journal/DB/outbox 恢复；不调用模型 |
| complete | 已采纳 | 唯一正式提交；可补物化，不重复采纳 |
| discarded / failed | 已放弃或执行失败 | 保留记录；不复活终结 Execution |

ExecutionRecord 的 queued/running/parked/succeeded/failed/remote_unknown/cancelled 与候选、Commit 分开。仅 Run 驱动路径创建 execution_records；既有聊天使用 ConversationTurn 作为执行权威，未机械复制第二份聊天状态。

旧记录缺少 executor 标识时按 legacy v1 解释；未知 executor/checkpoint 禁止续跑。旧已批准事务只有在 changeset 的 actor、runId、scope、payloadHash、accepted 状态均能验证时才派生审批，保留原确认时间和来源，不凭空补批准。
