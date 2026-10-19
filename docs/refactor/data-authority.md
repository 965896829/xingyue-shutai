# 数据权威与持久化

| 数据 | 权威 | 处理 |
|---|---|---|
| 正式项目、修订、文档 hash、事实、快照 | SQLite 事务 | 只由可信正式提交链改变 |
| 版本正文、请求/响应原文 | .novelclient/objects 的 SHA256 对象 | 不可变；读取/备份/激活检查 hash |
| 磁盘 Markdown | 物化副本和外部编辑来源 | 不能静默反写正式事实；外部修改先保留和核对 |
| 作者未保存编辑 | 渲染器本地草稿缓存 | 资源刷新/worker 恢复不覆盖 |
| Run 业务投影、候选版本 | runs / candidate_versions | 保留旧状态，候选每个指纹不可变 |
| 一次执行 | execution_records | 版本竞争；终结状态不复活，续作新记录关联父执行 |
| 远端请求和预算 | model_attempts、budgetBaseline | 意图先落盘，响应及用量后落盘；未知不算零 |
| 工具调用 | tool_executions | Run/Attempt/callId 作用域及参数 hash |
| 批准/提交 | approvals、candidate_commits、changesets、applied_transactions | 本地作者批准，事务内消费，一候选一次归属 |
| 文件同步 | materialization_outbox、事务日志、preserved | DB完成和物化完成独立；可本地重放 |
| 聊天原生协议消息 | ConversationTurn / Run 持久数据 | 继续请求使用原生字段，不从 UI 文本重建 |
| FTS、vectors、assessments、summaries | 派生结果 | 校验来源、版本和代次；不可覆盖正式来源 |
| 全局配置/凭据 | 原 userData，加密字段 | JSON损坏保留原件和副本；解密失败不抹除密文 |
| Pi 内部循环 | 非权威暂态 | 不写第二份会话真值，不自动恢复付费请求 |

SQLite 使用 WAL 和 FULL；关键状态转换与事件同事务，远端调用前持久化发送意图。UI delta/订阅异常不作为事务成败依据。进程恰好在发送意图与实际发包之间死亡时只能记录可能发送；没有宣称远端 exactly-once。
