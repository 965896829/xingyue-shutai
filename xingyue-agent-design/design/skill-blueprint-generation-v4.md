# 产品技能蓝图生成说明

从 `v4-skill-blueprints.json` 为每个包生成同名目录。`SKILL.md` 使用标准 YAML 的 `name`、`description`，正文只保留该包 `coreInstructions` 和 operation 到本包独立资源的映射；每个 `operations/<id>.md` 只写该 operation 的 `instructions`，不重复总控、包共同规则或整个 V3 专项。宿主选择操作后，仅组装一个总控、当前包共同规则、一个 operation、必要引用及唯一实际输出合同。`sourcePromptIds` 用于追溯与迁移，不能据此自动把对应 P 文件全文再次追加。其余字段生成本产品的 manifest，输入输出名称、validators 与 capability IDs 均为语义声明，实际 adapter、schema、校验器与权限执行必须实现并通过验收后才能启用；它们不是已存在的工具或权限凭证。`packaging.review` 必须先由宿主依 `targetKind` 解析一个审核合同。`compat_adapter` 保留旧实际合同和阶段门槛，另外两种绑定须完成对应设计版本的适配。新包注册不更新旧在途任务的资源 hash，19 包和 39 operation 均不表示额外串行模型请求，也不会安装为个人 ChatGPT Skill。

本蓝图的 `contextView` 是上下文编译策略，不是模型可自行选择的视角。`scoped_pov` 仍要结合场景叙述权限和每个角色的独立知情范围编译，不能把同批角色私有信息混成共享事实。`author_review` 可以给审核者必要的全局依据，但审核中引用给角色视角的片段仍须通过揭示边界检查。模型请求的 capability 需要宿主先按任务和授权过滤，输出声明不能扩大读取、写入、联网或发布权限。
