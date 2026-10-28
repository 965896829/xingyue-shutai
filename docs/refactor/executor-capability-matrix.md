# 执行器准入（0.4.78）

新任务和新聊天使用 `@earendil-works/pi-agent-core` 1.4.0。旧任务按记录中的执行器恢复；未写执行器的旧记录视为 Legacy，不更改其候选、次数或模型。旧 0.73.1 实验检查点仍只读保留。

完成结果：763 项完整测试通过，安装包工作进程隔离验证通过，167 个 Skill 文件与源码字节一致。详见[0.4.78 交付记录](pi-integration-0.4.78.md)。

Pi 实际运行 `runAgentLoop`，统一安排模型轮次、顺序执行工具和结束任务。客户端继续提供 Skill 阶段、上下文编译、模型/工具网关、持久化、预算和恢复规则。没有引入 Pi coding-agent 的命令行、第二套会话库或默认模型传输，也没有外层监督模型。

| 门槛 | 实现与离线覆盖 | 证据 |
|---|---|---|
| 原模型网关 | Pi streamFn 调用原网关；模型和协议配置不变 | refactor-pi、provider、responses、assistant 测试 |
| 不隐藏重试 | Pi maxRetries=0；未知请求原样保存，恢复检查不联网 | refactor-pi、refactor-runtime、network-recovery 测试 |
| 四协议保真 | 原始消息/native/工具参数始终由宿主保存和发出；Pi 仅持有调度投影 | refactor-pi 四协议续轮，以及原协议测试 |
| 关键写入等待 | 保存模型结果后才能执行工具；失败即停止 | refactor-pi 检查点门闩、截断输出测试 |
| 工具与正式稿边界 | 仅宿主工具网关校验原始参数；不重复套 Pi schema，不增加正式写权限 | refactor-tools、workflow、assistant 测试 |
| 取消与切换 | 沿用同一个 AbortSignal、排空与项目锁；迟到结果不执行工具 | refactor-pi、assistant、refactor-runtime 测试 |
| 累计预算 | 调度前沿用轮数/工具数/费用检查；结束完整候选不补发收尾请求 | refactor-pi、budget、planning-completion 测试 |
| 单一数据来源 | Pi 的临时投影不写回正式消息；两个适配器共享记录生命周期 | task-loop、executor-router、旧任务恢复测试 |
| Windows 交付 | 构建和打包完整性、隔离的本地模拟服务验证 | 本次交付记录，不代表覆盖安装验收 |
| 依赖许可 | 新作用域固定版本；MIT 文本绑定 v1.4.0 提交；生产依赖审计结果单独保存 | resources/licenses、audit-production-final.json |

本轮未调用真实模型。阶段结构、文件字段和错误/恢复行为由测试验证；真实文学质量、生成耗时和缓存率没有重新测量，不能用本地模拟服务结果替代。

实现入口：[task-loop](../../src/core/runtime/task-loop.ts)、[路由](../../src/core/runtime/executor-router.ts)、[版本决策](architecture-decisions/ADR-007.md)。测试和交付原始记录位于 `output/pi-integration-0.4.78-20261028/`。

## 历史：0.73.1 实验未准入（以下不代表 0.4.78）

生产默认 LegacyAdapter；Pi 开关关闭，且准入标志固定为 false。即使请求 Pi，也不会自动接入未准入路径；既有未知 Pi checkpoint 只读保留。

选定 @mariozechner/pi-agent-core 0.73.1，npm 元数据要求 Node >=20；实际Node24/Electron44。版本和完整依赖由 package-lock 固定。包已声明弃用并指向新作用域，本轮没有同时引入第二套框架。

| GATE | 本次证据 | 结论 |
|---|---|---|
| 01 网关覆盖 | 假 provider 两轮、所有入口计数与原生续轮 | 离线通过 |
| 02 无隐藏重试 | unknown 注入、restore不联网 | 离线通过 |
| 03 四协议保真 | Legacy四协议 fixtures通过；Pi仅统一消息层合成 native round-trip | Pi完整四协议矩阵未准入 |
| 04 等待关键写入 | 阻塞checkpoint时工具计数0；checkpoint失败中止 | 离线通过 |
| 05 工具权限 | schema、伪造正式工具拒绝、真实独立草稿/候选/作者提交 | 离线通过 |
| 06 取消/项目切换 | adapter stop，网关取消；生产Legacy切换/退出有实包证据 | Pi完整项目切换矩阵未准入 |
| 07 辅助预算 | 使用共用预算账本；并发预留及未知阻断通过 | Pi完整辅助功能组合未准入 |
| 08 无双主 | 自有对象/checkpoint、restore不再请求 | 离线通过 |
| 09 Windows打包 | 生产包刻意不含Pi依赖，未验证Pi实包 | 未准入 |
| 10 许可/供应链 | MIT元数据、提交绑定许可、锁文件、审计；开发依赖仍有高危项 | 未准入 |

Pi conformance 顺序完成只读 → 实际独立草稿文件 → 候选 → 可信作者提交。不是正式模型质量验收。Legacy继续保留 Chat/Responses/Anthropic/Gemini；Images 仍由封面功能独立处理。

许可依据：[固定提交 MIT License](https://raw.githubusercontent.com/badlogic/pi-mono/781152fc24841dc54b22284514604048ebe5e2c9/LICENSE)。npm tarball本身未包含 LICENSE文件，故另存固定提交许可；元数据见 test-evidence/pi-package-metadata.json。生产 npm audit --omit=dev 为0，开发树存在8项moderate和6项high，Pi关联 basic-ftp/proxy-agent 等依赖链阻止正式准入。不能把生产审计0解释成开发环境没有风险。
