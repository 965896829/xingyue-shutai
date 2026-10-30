# 星月书台番茄长篇创作设计包 V7

V7 把当前项目的架构审计并入 V6 完整方案。保留 Electron 独立写作内核、TypeScript、Pi、SQLite、统一网关、候选采纳与恢复，先整理模块和任务契约，再逐项落地创作增强。审计基线 0.4.82，固定提交 b505f6f459db74871f39f63acf6106b827c8a353。

## 当前阅读与实施入口

1. design/optimization-plan-v7.md 与配套 Word 报告：当前完整方案、架构章节、流程、更新提示词全文及来源。
2. design/agent-architecture-v7.md：模块职责、任务与状态归属、领域闭环和框架选择。
3. design/current-architecture-audit-v7.md：现有实现、保留项、改造触点与固定源码证据。
4. design/implementation-backlog-v7.md：R0 至 R5 的实际实施顺序。
5. design/codex-handoff-v7.md：可直接交给 Codex 的分批实施任务。
6. vnext/architecture-contracts-v7.ts 与 vnext/architecture-policy-v7.json：复用既有合同的宿主架构蓝图。
7. design/acceptance-protocol-v7.md 与 evaluation/architecture-v7-cases.json：架构验收协议与待执行案例。
8. audit/verification-v7.json：本轮实际验证和未执行范围。

## 创作设计与提示词继续使用

V2 共创和文风、V3 百万字记忆和人物动态、V4 按需技能、V5 题材世界书名与可视化、V6 质量验证和探索完整保留。V7 不新增创作操作或模型提示词，19 个技能包、48 个操作、50 个注册绑定和 112 项提示词来源保持原文。

完整提示词为 design/skill-catalog-v6.md；运行装配使用 vnext/skills-v6/assembly-policy.json、registry.design.json 和 contract-bindings.json。按任务选择一个总控变体、一个共同方法或替换、一个操作与必要上下文。V7 架构开发文档不拼接进模型请求。

## 优先级与兼容

本版覆盖 V6 A 至 F 的实施排序，采用 R0 基线与恢复契约、R1 模块拆分、R2 版本任务契约、R3 章节同版闭环、R4 增量性能、R5 创作增强。旧版功能和质量要求继续有效。V7 是整体交付版本，具体合同与提示词保留各自语义版本，不全局替换所有 V6 字符串。

当前客户端 26 内置技能与目标 19 包不是同一目录，不直接将常量 26 改成 19。旧任务沿原 executor、checkpoint、资源和协议恢复；新能力逐项完成真实适配后才能启用。现有 runtime/operations.ts 是 UI 幂等回执，能力 operation registry 不能替换它。

## 实施原则

- 保留 SQLite 正式事实源、内容对象、CAS、outbox、候选指纹、预算和 unknown 保护，不平行再造状态账本。
- 创建、章节、共创讨论和修订采用清楚的工作流模块；S01 至 S11 保留引导，动作按必要资料与版本放行。
- reader_prefix 和 character_turn 隔离完整请求、工具、历史、检索、缓存及错误反馈；宿主私有证明不发给模型。
- 正文和核心记忆同版采纳；可选投影异步重建，人物卡与图谱不单独写回一套正史。
- 正常三方向仍为一次请求；人物状态批量更新，排演、首读和偏好学习按需调用；查看图和回放不调用模型。
- 当前已有增量快照，优先优化事实更新与查询；按实际性能再选择替代索引或基础设施。

## 当前验证范围

V7 架构案例与 V6 的 40 个案例均保留待执行状态。静态类型、注册、哈希、保留文件与报告排版检查不代表客户端功能、真实模型质量、真人偏好或百万字连续创作已通过。

目标 registry 中所有包 active=false，adapter unavailable。文件是产品设计资源，不是已安装个人 Skill。没有修改远端仓库、产品代码或发布应用。旧版验证保留原作用范围和历史报告哈希，本轮结果见 audit/verification-v7.json。

代码无解释性注释，说明在文档中。仓库开发 AGENTS.md 与应用写作 agent.md 分开。Codex 先核对实际 HEAD 和本包新增文件，再按批次实施。
