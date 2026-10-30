# A 版：0.4.82 原合同兼容专项提示词

这是 26 项专项技能的设计候选，尚未安装。目标是让职责、必要流程、质量条件、停止边界与输出更清楚；没有为缩短文本删掉模板字段、完整批次、当前五项审稿证据或版本/权限保护。

## 使用与生效

每个 `skills/<id>/SKILL.md` 映射到仓库同名 runtime 路径。保留原参考文件引用，仍由宿主显式注入 controller、shared-contract、按技能选择的 agent-guidance、原模板、输出结构约束与工具 schema。下表字符数只计算本文件，不代表最终发送长度。

修改内置技能需将其 SHA-256 同步到 skills.registry.json，并重建 resources.lock.json；本目录 manifest 的 hash 是本设计文件的校验值，不是已经生效的客户端登记。原 contract.json 不变。运行中的任务不能静默换规则；旧 prompt/hash 与恢复记录按原版本处理。

仅换专项提示词不会移除正文默认 192 条表达规则、8,901 字符的默认命名守卫或叙事节点要求。真正的输入减负需实现报告所列 expression-rules、命名分流和可选 telemetry 改动；A 版不假装已拥有那些改动。

## 共同继承的硬合同

- 作者本轮明确修订和原始硬要求优先，兼容的已采纳设计可继续使用；正式稿、计划、草稿、推测与人物认知分开。
- 宿主维护权限、版本、费用、工具回执、存储、模板、采纳与推进；模型不自我批准、不发布、不编造工具或来源。
- 输出用原模板的标题、字段顺序、表头和范围。普通字段各说一件事，复杂因果保留，不加重复附表、诊断报告或完成证明。
- 工具只用实际请求列表。候选提交绑定 baseHash；精确补丁/分段/引用使用真实来源和回执；缺依赖、版本冲突、未知远端结果、预算上限按现有宿主边界停止相关操作。
- 文学偏好不冒充确定性错误；风格规则按场景、证据与例外使用，不报告 AI 来源概率，不靠故意错字或随机句段制造自然感。
- 普通已授权细节直接设计并供当前阶段审阅，不为每个新细节增加批准。只有真实改变硬约束/核心方向的缺口才提出具体待决问题。

## 运行方式

`host` 表示现有本地代码能力，不新增模型请求；`prose` 表示正文无工具调用；`review/memory` 是现有正文 pipeline 分工；`analysis/revision` 是已有可选任务模式。独立 skill.run 与 pipeline 的输出权限仍以当次真实宿主指令为准。

新版“从创意开始”在 S01 内走专用三案/完整方案流程；方案已包含并校验设定拆解，统一采纳后直接到 S02，不再调用一次本包 premise-lab。该入口的专用提示词与 submit_planning_report 等专用工具属于另一组合同。本包保留 S01 专项用于既有阶段能力与兼容，不能据此添加重复步骤。默认 S10 pipeline 同时生成正文、审稿与章后候选，采纳时完成逻辑 S10/S11。

| 技能 | 主阶段 | 运行方式 | 本文件字符 | 文件 |
|---|---|---|---:|---|
| webnovel-project-bootstrap | — | host | 707 | `skills/webnovel-project-bootstrap/SKILL.md` |
| webnovel-market-research | — | analysis | 733 | `skills/webnovel-market-research/SKILL.md` |
| webnovel-premise-lab | S01 | stage | 890 | `skills/webnovel-premise-lab/SKILL.md` |
| webnovel-project-config | S02 | stage | 844 | `skills/webnovel-project-config/SKILL.md` |
| webnovel-world-engine | S03 | stage | 782 | `skills/webnovel-world-engine/SKILL.md` |
| webnovel-character-engine | S04 | stage | 1068 | `skills/webnovel-character-engine/SKILL.md` |
| webnovel-name-governance | — | revision | 756 | `skills/webnovel-name-governance/SKILL.md` |
| webnovel-voice-profile | — | revision | 812 | `skills/webnovel-voice-profile/SKILL.md` |
| webnovel-volume-architect | S05 | stage | 809 | `skills/webnovel-volume-architect/SKILL.md` |
| webnovel-chapter-roadmap | S06 | stage | 878 | `skills/webnovel-chapter-roadmap/SKILL.md` |
| webnovel-rhythm-designer | S07 | stage | 794 | `skills/webnovel-rhythm-designer/SKILL.md` |
| webnovel-batch-outline | S08 | stage | 940 | `skills/webnovel-batch-outline/SKILL.md` |
| webnovel-chapter-planner | S09 | stage | 978 | `skills/webnovel-chapter-planner/SKILL.md` |
| webnovel-chapter-drafter | S10 | prose | 1045 | `skills/webnovel-chapter-drafter/SKILL.md` |
| webnovel-chapter-reviewer | — | review | 1092 | `skills/webnovel-chapter-reviewer/SKILL.md` |
| webnovel-prose-polisher | — | revision | 721 | `skills/webnovel-prose-polisher/SKILL.md` |
| webnovel-continuity-audit | — | analysis | 739 | `skills/webnovel-continuity-audit/SKILL.md` |
| webnovel-memory-extractor | S11 | memory | 1214 | `skills/webnovel-memory-extractor/SKILL.md` |
| webnovel-batch-close | — | host | 696 | `skills/webnovel-batch-close/SKILL.md` |
| webnovel-revision-cascade | — | revision | 867 | `skills/webnovel-revision-cascade/SKILL.md` |
| webnovel-context-retriever | — | host | 779 | `skills/webnovel-context-retriever/SKILL.md` |
| webnovel-packaging | — | analysis | 682 | `skills/webnovel-packaging/SKILL.md` |
| webnovel-reader-feedback | — | analysis | 699 | `skills/webnovel-reader-feedback/SKILL.md` |
| webnovel-project-validator | — | host | 737 | `skills/webnovel-project-validator/SKILL.md` |
| webnovel-narrative-telemetry | — | analysis | 788 | `skills/webnovel-narrative-telemetry/SKILL.md` |
| webnovel-memory-audit | — | host | 715 | `skills/webnovel-memory-audit/SKILL.md` |

## 提交前必要核对

保留 26 个 ID，所有 reference 路径能在目标 runtime 解析；registry/lock 与新内容一致；S01—S11 模板 fixture 通过；review 仍为五项；writer 仍无工具；memory facts 空数组也可明确完成；S06/S08 中断续传不丢已接受批次。纯宿主技能的 prompt 只是职责文档，不能以重写提示词声称已改变本地执行行为。

这些是结构兼容的设计候选，尚未经过真实模型生成、作者盲评或读者实验。应先在隔离项目中对同一输入比较，再决定默认启用版本。
