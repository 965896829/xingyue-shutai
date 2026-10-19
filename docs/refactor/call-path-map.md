# 入口与调用出口

## 命令链

React → shared/client（校验、AbortSignal、等待取消）→ preload 白名单与普通对象 envelope → main（可信 mainFrame、项目会话、workerGeneration）→ worker（握手、schema）→ Service → 领域能力。业务调用不把 ipcRenderer/fs/shell 暴露给页面。

requestId 用于一次 IPC 等待；waitId 用于取消等待；operationId 用于作者写意图；projectSessionId 隔离同一作品的不同打开；workerGeneration 隔离重启。取消等待不宣称后台撤销。

0.4.2文档预览：Service → ResourceScheduler的document-import资源 → DocumentImporter → document-worker线程 → 纯文档解析器 → 同一命令输出契约。线程只读取作者选择的源文件，不打开项目数据库，不创建正式候选。Electron注入线程实现；直接构造Service的测试/工具仍可使用同步解析兼容默认。退出drain停止排队导入并终止活动线程，等待线程退出后释放调度资源。

## 远端出口

| 调用者 | 网关 | 底层网络 |
|---|---|---|
| AgentRunner 普通/正文流水线 | callModel，归属 Run | provider.invokeModel |
| ConversationRunner 讨论/草稿 | callModel，归属 turn | provider.invokeModel |
| 标签规划与独立审核 | callModel，归属规划 Run | 注入 Caller/原 provider |
| 辅助叙事评估 | callModel，归属主 Run、同一预算和取消链 | telemetry caller |
| 向量建立与查询 | callExternal，语义 purpose/版本/来源 | embeddings 请求 |
| 搜索/提取与连接测试 | callExternal，宿主传 store/owner | PublicSearch |
| 文字/工具连通性测试 | callModel，管理请求仓库 | provider |
| 模型目录（含分页） | callExternal，管理请求仓库 | model-catalog |
| 图像生成及其返回图片获取 | 一个 callExternal 外部操作 | cover.generateCover |
| Pi 离线实验 | 同一 callModel/Tool Gateway | 注入假 provider；未进入生产 bundle |

模型目录分页、封面后续图片读取作为一个外部操作登记；没有逐个 GET 单独建立付费 Attempt。原 runner 中通用 terminal/network 分支仍为旧兼容代码，模型工具集合和网关均明确拒绝，正式执行无法由模型触发。可信宿主终端帮助方法仍由旧回归测试覆盖。

## 工具与提交

工具定义包含参数 schema；beginTool 在 handler 之前校验、登记作用域键/参数指纹/效果。finishTool 将业务持久化、结果和事件放在事务内。已完成调用复用结果；相同键不同参数拒绝；中断的写工具不自动重放。

正式写入入口：Service 的项目创建/配置、手动文稿候选采纳、标签投影恢复、影响核对和 run.accept → ProjectCommitService → 原 FileStore 提交内核。Run 提交必须存在绑定候选、范围、项目、快照与最终内容的本地作者审批。模型不持有 Approval/Commit 能力。

导入、备份恢复使用各自已授权的隔离新目录流程。独立草稿保存不成为正式作品提交。
