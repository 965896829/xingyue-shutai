# 当前架构审计与改造边界 V7

## 基线与判断

源码基线为 `965896829/xingyue-shutai` 的 0.4.82，固定提交 `b505f6f459db74871f39f63acf6106b827c8a353`。本次审计读取执行、状态、上下文与关键测试代码，并核对官方框架资料。测试覆盖在本文件中表示仓库已有相应代码，不表示本次执行通过。产品代码尚未因设计包而变化。

结论为保留现有执行和持久化底座，整理领域工作流与任务契约。当前项目的工程可靠性已有基础，主要扩展压力是多类创作业务聚合、阶段和路径依赖、整请求视角编译、全量事实处理及额外评估对关键路径的影响。

## 现有真实调用结构

React 界面经 preload 调用命令，Electron 主进程校验并转发，独立写作内核持有 Service。Service 创建并调度任务，ExecutorRouter 根据保存的执行器版本路由；AgentRunner 与 ConversationRunner 通过 TaskLoop 使用 Pi。模型和工具实际经过本项目网关，输出先形成候选，正式采纳回到宿主提交入口。

| 已有机制 | 代码证据 | V7 处理 |
| --- | --- | --- |
| 独立写作内核和恢复握手 | [main](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/electron/main.ts#L176) 和 [worker](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/electron/worker.ts#L17) | 保留，不从头增加第二套微服务 |
| Pi 薄调度和宿主请求权 | [task-loop](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/task-loop.ts#L40) | 保留顺序工具与内建重试关闭 |
| 执行器版本和既有恢复 | [executor](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/executor.ts) | 旧任务固定旧语义 |
| 发送意图 回执 费用和 unknown | [model-gateway](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/model-gateway.ts#L40) | 所有新子任务继续接入 |
| 工具参数与副作用回执 | [tool-gateway](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/tool-gateway.ts) | 保留并显式定义 effect |
| 候选审批与正式采纳 | [commit-kernel](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/commit-kernel.ts) | 保持一个正式写入口 |
| SQLite 事务 对象及 Outbox | [storage](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/storage.ts#L744) | 增强领域写入和增量更新 |
| CAS 状态版本与合法迁移 | [saveRun](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/storage.ts#L238) | 不能用新流程绕过 |
| 结构化记忆和证据 | [Fact](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/shared/types.ts#L192) | 沿用来源和时域，深化人物心智 |
| 增量快照 delta-v1 | [snapshot-codec](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/snapshot-codec.ts#L17) | 已实现，继续保留 |
| 自由讨论及已授权候选修改 | [service](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/service.ts#L1432) | 扩展到更一致的任务契约 |

正式资料不是由模型任意改写的工作区文件。数据库确定正式文档版本，内容对象按哈希保存并校验，文件物化失败可通过 Outbox 恢复。外部改稿需要核对，不能用旧正式内容静默覆盖。远端模型结果未知仍可能涉及已发生费用，本地幂等采纳不能被宣传为远端 exactly once。

## 具体扩展压力

### 业务职责集中

Service 同时处理作品生命周期、任务启动、聊天提议和正式采纳；AgentRunner 同时处理流程分发、上下文、提示词、模型策略、审稿、修复与评估。文件大小本身不是问题证据，多种变化原因同时集中才是扩展风险。V7 先提取四类领域工作流与命令处理器，保持行为，再引入新能力。[Service](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/service.ts) [Runner](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runner.ts#L369)

### 阶段和技能仍有固定耦合

阶段输入按 S01 至 S11 和文件路径前缀累加。技能注册固定 26 项，部分参考资料由技能名称匹配选入。仅增加提示词文件无法接通新权限、输入输出和恢复。V7 保留阶段引导，把任务资格改为所需产物与版本校验；保留旧 26 技能兼容资源，19 个新设计技能仍需真实适配后才能启用。[阶段规则](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/domain.ts#L89) [技能注册](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/skill-registry.ts#L60)

### 副作用分类依赖工具名

当前 propose_ 和 submit_ 前缀被分类为候选写，save_draft 为草稿写，其余为只读。现有白名单和 schema 仍有效，不能据此宣称已经发生越权。新增写工具时应改为明确的 effect、scope、回执和未知结果策略，避免漏改名称分类。[源码](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/tool-gateway.ts#L14)

### 人物视角过滤不等同于整请求隔离

memory-studio 已按作者、读者和人物过滤事实；context-compiler 仍可提供作者规则和未来揭示信息，用于全知写作任务。V6 独立初读和人物排演尚未实装，接入时必须同时处理系统、资料、工具、历史、缓存、会话和修复反馈。不能把现有作者写作上下文直接当成 reader_prefix 或 character_turn。[事实可见性](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/memory-studio.ts#L25) [上下文](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/context-compiler.ts#L27)

### 快照增量不等于每轮计算增量

applyJournal 会读取全部 04_ 正式台账并 replaceFacts；retrieveMemory 和 characterState 先加载全部事实；sourceValid 对证据读取来源对象；compileContext 又有一轮事实筛选。它们构成增量更新、索引查询和共享来源校验缓存的优化切入点。本次未进行延迟基准，现状应描述为规模风险，不是已复现性能故障。[正式事实重建](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/storage.ts#L807) [查询](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/memory-studio.ts#L101)

### 实时评估不全部是本地绘图

当前正文开始前可能等待计划评估，审核后可能等待最终评估；telemetry 实际调用模型。V7 让可本地计算的图谱与状态优先读结构化投影，额外语义判断成为明确任务；可选观察移出正文关键等待链路，核心检查继续存在。[正文前评估](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runner.ts#L1028) [正文后评估](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runner.ts#L1287)

## 测试证据边界

仓库的 runtime 测试包含 CAS、回执、预算、候选指纹、物化、外部改稿和资源互斥；crash 测试通过子进程硬终止检查数据库提交与物化边界；memory-safety 包含来源失效、历史回看、前文修订和候选变动导致审核失效。它们是后续重构需要保留的工程回归，不是本次已执行的结果，也不是文学质量证明。[运行时测试](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/refactor-runtime.test.ts) [崩溃测试](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/refactor-crash.test.ts) [记忆测试](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/memory-safety.test.ts)

scale.ts 构造 1200 章和 300 万字合成文本，主要检查一次提交、扫描、编号检索与章号边界。重复填充文本不包含同等复杂度的动态人物事实、持续修订或真实伏笔。V7 需另测随事实与修订增长的查询、采纳、重建和首屏负载，并通过有答案的跨章案例检查记忆准确性。[规模测试](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/scale.ts)

## 框架参考与适配结论

Pi 当前官方上游为 earendil-works/pi，项目依赖 @earendil-works/pi-agent-core 和 pi-ai 1.4.0。上游 main 文档只用于理解接口方向，不能假定应用已安装版本具有 main 的全部行为。[Pi 官方](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md)

LangGraph TypeScript 将线程检查点与跨线程 Store 区分，恢复 interrupt 会重新进入节点。可以借鉴节点、依赖和恢复方式，但小说事实、角色知情、授权、版本和远端重复请求问题仍需领域实现。[持久化](https://docs.langchain.com/oss/javascript/langgraph/persistence) [中断](https://docs.langchain.com/oss/javascript/langgraph/interrupts)

Temporal 生产环境需部署应用 Worker 和 Service，支持自建和托管；它的记忆与状态说明强调长期记忆、执行状态和外部效果的权威不同。对现有桌面产品，优先复用本地记录与事务；跨机器或关机后持续执行成为明确需求时再评估。[部署](https://docs.temporal.io/production-deployment) [记忆与状态](https://docs.temporal.io/ai/featured/memory-state-stripe)

Anthropic 2026 年 4 月文章讨论持久 session、harness 与工具环境的稳定接口，并将 session 与模型 context window 区分。V7 吸收的是接口和状态分离，不要求改用托管服务。[官方文章](https://www.anthropic.com/research/managed-agents)

架构建议依据产品形态与已有源码能力，不按 GitHub 星数评价小说质量。方案不将框架替换、Agent 数量或提示词长度作为爆款潜力、真人文风和人物生命力的替代指标。
