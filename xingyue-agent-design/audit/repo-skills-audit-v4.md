# 星月书台 V4 内置技能工程审计

核验日期：2026-10-29。当前 GitHub main 由主代理重新核验为 `b505f6f459db74871f39f63acf6106b827c8a353`，项目版本 `0.4.82`。本报告只读审计源码快照与现有 V3 设计包；未修改应用代码，未安装个人 ChatGPT Skill。

## 结论

项目已经有 26 项注册技能、阶段分派、五项宿主职责、资源 SHA 锁、候选写入限制、实际工具白名单、上下文版本绑定与恢复控制。下一步应把现有机制整理成可执行、可测试、可扩展的技能合同，并落实 V3 的对象与记忆语义。仅再增加几个 SKILL.md，不会解决百万字记忆、人物认知与文风问题。

现有 26 项中，模型可执行项为 21 项；五项宿主职责为 project-bootstrap、project-validator、context-retriever、batch-close、memory-audit。注册表对它们仍写相同模型工具列表，但实际 `skill.run` 分支直接执行本地逻辑，不发送相应技能模型调用。

## 一、现有实现的准确边界

| 能力 | 现有实现 | 证据 |
| --- | --- | --- |
| 技能选择 | S01–S11 映射固定技能；显式 `skill.run` 指定技能；没有把 26 项名称交给模型自动发现的统一路由 | R01、R05 |
| 注册 | Zod 校验固定 26 项、ID 唯一；条目校验 id/title/description/stage/optional/path/contract/sha256/tools，JSON 中 version 尚不属于该条目 schema | R01 |
| 资源完整性 | 非 agent.md 文件必须匹配 resources.lock.json；SKILL.md 另比 entry.sha256。agent.md 允许编辑，但检查非空、NUL 和 96 KB；执行时绑定哈希 | R01、R06 |
| 技能权限 | contract 必须 candidate-only、不能 approve/commit/publish，且 tools 与注册表相同；真正执行再检查工具授权、阶段路径、版本与候选范围 | R01、R02、R07 |
| 技能加载 | 一次总控＋当前专项；去掉 YAML；prose 模式移除专项输出章节；固定 shared-contract/agent-guidance，再按反引号引用正则装入全部匹配参考文件 | R01 |
| 已有局部加载 | agent-guidance 按技能类别切章节；命名模块不按上述正则全装，另有 read_naming_rules；prose 阶段过滤共享输出契约 | R01、R03 |
| 当前输出契约 | S 阶段仍以完整 Markdown 文档及固定模板为核心，review 使用五项 wenxu-review，memory 使用 propose_changes/facts/complete | R03、R10 |
| Pi 的角色 | Pi 调度宿主提供的 request/execute/finish；不会另开模型网关、另算重试或写第二套会话；工具 sequential，maxRetries:0 | R04 |
| 调用恢复 | task、模型配置、总控、专项、工具、上下文源版本已有绑定；变更时判 stale 或要求重建。tool execution 有幂等票据 | R06、R07、R08 |
| 讨论通道 | 单独 ConversationRunner，已有 read_book/read_rule/search_memory/propose_action；不是完全缺少共创。任务卡冻结模型/项目/来源版本 | R09 |
| 缓存 | 已拆共享规则、去重重复 manifest 文本，并把源资料保留为 user 数据；不是完全没有 Prompt Cache 设计 | R11 |
| 创意/命名 | 有独立 creation prompt 资源锁与旧新版本路由；并非所有任务都走 26 项 Skill 的文本拼接 | R12 |

## 二、最值得推进的十项改造

### 1. 从固定 26 项改为有版本的能力目录

把模型技能、宿主能力、可选分析任务分开登记，明确 `executionKind`、版本、输入输出 schema、工具、依赖和兼容范围。删除硬编码 `.length(26)`，改为唯一 ID、声明依赖存在、无依赖循环和支持的 schemaVersion 校验。固定阶段继续由路由器明确选择，自动发现仅服务开放式讨论。

依据：R01、R05。迁移风险：`skills.list` 的 IPC schema 也只认现有字段，不能只改 JSON 而不改共享合同。现有旧任务必须继续用原 ID 适配。

### 2. 将契约中的自然语言约定变为宿主可执行规则

现有 `contract.json` 中 inputs、outputs、max_repairs、requires_consistent_snapshot、acceptance_criteria 大多是说明；SkillRegistry.get 只直接验证权限与 tools。它们的实际行为另写在 runner、domain 和 validation。

建议 manifest 引用注册的输入输出 schema 和验证器 ID，声明真实文件/对象写入范围、必要上下文种类、修复预算、幂等与版本要求，构建时验证声明与适配器一致。合同只能选择宿主已实现能力，不能通过文件内容注册任意代码权限。

依据：R01、R02、R03、R10。迁移风险：不能宣称换 manifest 后旧 runner 会自动遵守新对象输出；必须实现 adapter。

### 3. 把正则找引用改为显式的按需上下文编译

当前引用文件只要命中反引号路径就完整拼进 system，不是真正按任务内容选择资料。保留已有总控＋一个专项，额外引用以 `required/conditional/on-demand` 声明，宿主按 mode、对象类型和阶段选段。只有确实缺资料时才允许请求一个受限的资料读取工具，不为预先已知需求增加模型读文件往返。

依据：R01、R03。迁移风险：删掉长参考文件前必须把机器协议与必要模板留在 schema/adapter，不能靠压短导致五项 review、角色字段或旧阶段产物丢失。

### 4. 所有技能共用同一版本与视角上下文

把 V3 的 project/branch/revision、故事时间、揭示点、角色获知点、read-set、source hash、Unicode 码点位置放进宿主编译的 TaskEnvelope 和 MemoryPacket。讨论、正文、审阅、反思、查询都消费这一套边界，不能另造无来源“技能记忆”。

依据：R06、R09、R13。迁移风险：当前讨论任务卡对整个规则树和全部文档绑定，虽然保守可靠，但会让不相关规则变更也使任务失效；缩窄到实际 read-set 时必须保留集合/缺失查询依赖，不能只保留已读取记录 ID。

### 5. 最小工具权限由宿主求交集

目前 25 个注册项使用相同七工具列表，市场研究另多两个工具，review/memory 再在代码中过滤；writer 的 prose 子调用已经无工具。V4 应按实际任务交付：纯正文可无工具，结构化任务通常只开放一个提交工具；补读与联网有独立能力。最终工具集取技能声明、宿主能力、任务模式、作者授权和当前状态的交集。

依据：R01、R02、R03、R07。这是精细化而非修补完全不存在的权限系统。旧工具回执和恢复记录不能因为新工具改名而失去解析能力。

### 6. 编排由宿主工作流决定，Skill 不自己扩张成 Agent 群

已有 Pi 分工清楚，应保留。三个创意方向仍一次正常提交；章后角色与记忆仍批量更新；章节审核整合多个检查视角。角色反思、连续性专项、市场研究、模拟反应只能按真实触发运行，不按角色数量固定追加调用。

依据：R04、R06、R12、R13。迁移风险：包装为“一个 Skill”不等于一次调用，评测与界面应分别记录模型调用、工具调用、本地任务和 token/费用。

### 7. 记忆部分落实 V3 增量合同，不继续搬完整台账

当前章后 memory 子阶段把 memoryPaths 完整内容设为 required，模型必须保留未变内容。V4 memory skill 只接收本章定稿、受影响对象状态、必要前史和覆盖名单，输出候选 Delta；宿主负责源验证、七类角色状态投影、失效重算、事务与索引。

依据：R13。迁移风险：不能提前删除旧台账输入而保留“输出整个台账”的旧合同；必须一起改 extraction schema、merge adapter、独立 memory review 和 commit kernel。旧模板与 Markdown 输出可继续由宿主投影供阅读。

### 8. UI 消费同一结构化对象，而非再开可视化模型

角色卡、动态心智、关系边、承诺、世界规则与规划节点由 typed output 存储；面板从这些对象及版本直接渲染。`view` 是展示描述，不是编造第二份事实的 Skill。需要语义情绪/叙事标注时复用已有审阅或按需评估，不把曲线数值当事实真值。

依据：R10、R13。迁移风险：现有 Markdown 模板和 schema 绑定严格，V4 对象输出要有桥接投影，不能同时让 Markdown 与对象存储各自成为权威。

### 9. 做技能级评测，覆盖触发、结果与成本

保留已有资源一致性与模式测试，加入：正确与错误触发、边界否定案例、冻结字段、角色误解隔离、过期来源、局部采纳依赖、旧任务恢复、外部资料不能扩权、请求未知结果不自动重发、输入 token 预算与额外调用数。文风与故事效果采用盲评样稿和作者采纳反馈；机器规则只验证可证事实。

依据：R07、R08、R10、R14。迁移风险：提示词断言测试只能证明规则文本存在，不能证明实际模型表现；需要离线固定样例和独立人工/模型评估，区分本地测试与付费模型测试。

### 10. 技能包不可变版本与渐进发布

保留资源锁并生成包级摘要，记录 core、skill、schema、工具和引用文件摘要。已开始的任务固定旧包；新包先进入 shadow / opt-in，再逐阶段迁移。0.4.82 全批次路线门槛、五项 review、propose_changes 协议与三个方向/命名的旧版本分支必须留 adapter。

依据：R01、R06、R08、R12。迁移风险：现有方向和标题有独立指纹域，不能把全技能目录摘要无差别绑给所有任务而扩大失效范围；加载安全检查可以覆盖包，任务语义版本只绑定实际依赖。

## 三、全部 26 项的建议映射

下表是职责映射，不强行规定 V4 最终文件数量。多个 mode 可放在一个技能包，但一次只加载当前 mode；合并职责不意味着一次强行生成多个阶段。

| 当前 ID | V4 去向 | 处理 |
| --- | --- | --- |
| webnovel-project-bootstrap | Host ProjectLifecycle | 保留建项、导入、目录修复为本地能力；不需要模型技能 |
| webnovel-market-research | market-evidence | 保留为按需证据研究；检索执行由宿主连接器 |
| webnovel-premise-lab | concept-forge、story-contract | 三案与采纳后完整方案各司其职；已有完整方案则不重复 S01 |
| webnovel-project-config | co-creation 的 config mode＋Host ConfigValidator | 讨论与建议可由模型做，配置解析和授权状态由宿主执行 |
| webnovel-world-engine | world-design / co-creation world lens | 保留世界规则和体系设计；与对象讨论共用数据合同 |
| webnovel-character-engine | character-design / character reflection | 稳定角色核设计与按需成长反思；每章动态状态由 memory-delta 批量处理 |
| webnovel-name-governance | naming mode＋Host NameRegistry | 起名/改名建议与别名冲突检查分工；承认已有名称，保留实体 ID |
| webnovel-voice-profile | voice-calibration | 项目声音规则、场景样本、用户选择绑定版本 |
| webnovel-volume-architect | rolling-outline volume mode | 长线承诺、卷级节点、终局；卷名仍在该任务内，不固定另开代理 |
| webnovel-chapter-roadmap | rolling-outline roadmap mode | 合并同一包，保留章序权威与可独立采纳对象 |
| webnovel-rhythm-designer | rolling-outline rhythm mode | 节奏作为规划视角，通常随当前规划任务生成；作者单独要求时可独立运行 |
| webnovel-batch-outline | rolling-outline detail mode | 新工作流可滚动近细远粗；旧任务继续全批次产物门槛 |
| webnovel-chapter-planner | scene-contract | 场景参与者、目标、阻力、选择、信息、结果与允许变化 |
| webnovel-chapter-drafter | chapter-draft | 纯正文，VoiceSlice＋MemoryPacket＋SceneContract |
| webnovel-chapter-reviewer | chapter-review | 整合证据式审阅，保留原五项兼容 adapter |
| webnovel-prose-polisher | voice-revision / local-repair mode | 文风修订和证据问题修复共享范围控制，按目标选 mode |
| webnovel-continuity-audit | chapter-review continuity lens＋按需 audit mode | 普通章不重复固定审一次；修订、回归人物等场景触发专项 |
| webnovel-memory-extractor | memory-delta-v3＋memory-review-v3 | 一次批量提取本章事实/角色七类状态，沿用必要独立审核 |
| webnovel-batch-close | Host BatchClosure＋可选摘要任务 | 归档、进度、完整性为本地；需要语义摘要则显式有来源模型任务 |
| webnovel-revision-cascade | co-creation-editor / revision mode＋Host DependencyEngine | 模型提出最低必要内容变化，宿主算依赖、失效、回滚和提交 |
| webnovel-context-retriever | Host ContextCompiler / MemoryQueryService | 默认检索编译零模型调用；自然语言复杂查询可调用 memory-query-v3 |
| webnovel-packaging | packaging | 书名、简介、入口承诺；保留 creation/title-market-editing 的实际数量与版本合同 |
| webnovel-reader-feedback | reader-feedback | 真实样本与模型模拟分开，改动建议不自动覆写故事 |
| webnovel-project-validator | Host ValidationEngine | 字段、引用、对象关系、范围与版本门槛确定性检查 |
| webnovel-narrative-telemetry | chapter-review telemetry lens＋Host Metrics | 计字/重复等本地；语义曲线按需并标注来源与不确定 |
| webnovel-memory-audit | Host MemoryIntegrity＋按需 memory-query | 索引水位、覆盖、来源和过期关系本地检查；语义解释才使用模型 |

## 四、四个术语必须区分

Prompt 是一次任务的指令文本。Skill 是可版本化能力包，含触发描述、专项步骤、schema/参考资源与验证入口。Subagent 是有独立执行上下文和调用预算的模型任务，只有任务隔离或独立评估收益明确时才需要。Host Service 是实际权限、检索、事务、状态、版本、缓存、索引和 UI 投影的确定性执行程序。

Skill 数量、子代理数量、单次模型请求数不是同一件事。一个写作 Skill 可以只有一次正文调用；一个工程 Skill 也可能编排几个经测量必要的子任务。它们都不能自行批准候选、把假设升级成正史或绕过宿主工具权限。

## 五、来源

所有源码链接固定到本轮核验提交。行号为本地 `nl -ba` 所读范围。

- R01 `src/core/skill-registry.ts` 9–19、22–58、64–127。
- R02 `src/core/runner.ts` 184–195、1490–1596。
- R03 `src/core/skill.ts` 86–144。
- R04 `src/core/runtime/task-loop.ts` 40–125；`src/core/runtime/pi-executor.ts` 9–18。
- R05 `src/core/service.ts` 722–726、1328–1367；`src/shared/contracts.ts` 147–149。
- R06 `src/core/runner.ts` 277–297、903–905、943–959；`src/shared/types.ts` 370–430。
- R07 `src/core/runtime/tool-gateway.ts` 14–44、59–66。
- R08 `src/core/runtime/operations.ts` 23–46；`src/core/runtime/commit-kernel.ts` 7–27。
- R09 `src/core/conversation-runner.ts` 64–123、142–156、166–240。
- R10 `src/core/skill-output-contract.ts` 44–63、66–97；`src/core/domain.ts` 89–121。
- R11 `src/core/runtime/prompt-cache.ts` 4–62。
- R12 `src/core/creation-prompts.ts` 20–58、144–178。
- R13 `src/core/runner.ts` 1149–1171；V3 `design/long-memory-v3.md`、`design/character-mind-v3.md`、`design/data-contracts-v3.md`。
- R14 `tests/creation-prompts.test.ts` 240–266；现有 tests/refactor-pi.test.ts、task-recovery.test.ts、concise-directions.test.ts。

原始注册表 `resources/skill/runtime/skills.registry.json` 1–529。示例技能契约 `resources/skill/runtime/skills/webnovel-chapter-drafter/contract.json` 1–31，`webnovel-context-retriever/contract.json` 1–32，`webnovel-market-research/contract.json` 1–33。
