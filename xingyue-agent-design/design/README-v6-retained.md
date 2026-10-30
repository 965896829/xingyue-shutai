# 星月书台番茄长篇创作设计包 V6

V6 将作品质量验证、作者声音和自由探索接到 V5 的完整长篇架构。审计基线为 0.4.82，提交 b505f6f459db74871f39f63acf6106b827c8a353。交付为设计与工程蓝图，尚未接入应用，未修改远端仓库。

## 先读这些文件

1. design/quality-creative-architecture-v6.md 与配套 Word 报告：完整方案、新增总控和更新提示词全文。
2. design/implementation-backlog-v6.md：开发顺序、依赖与验收。
3. design/codex-handoff-v6.md：可直接交给 Codex 的实施任务。
4. design/skill-catalog-v6.md：全部 19 个技能与 48 个操作指引。
5. vnext/quality-creative-contracts-v6.ts 与 design/data-contracts-v6.md：新合同和宿主不变量。
6. vnext/skills-v6/assembly-policy.json、registry.design.json 与 contract-bindings.json：装配、停用注册及实际类型映射。
7. design/acceptance-protocol-v6.md 与 evaluation/quality-creative-v6-cases.json：真实质量验收和 40 个待执行案例。
8. audit/verification-v6.json：本轮实际执行验证与边界。

## 版本与保留

V2 的共创、试写和声音，V3 的百万字记忆、人物心智和同版事务，V4 的按需技能，V5 的题材、世界、书名和可视化继续生效。旧资源逐字保留，旧任务固定旧协议。V5 原 README 和 manifest 另存保留文件；顶层 README、manifest 和累计来源索引随本版更新。

V6 保持 19 包，新增六个操作，共 48 操作；标题审核三个对象绑定继续分别装配，共 50 个注册绑定。3 个总控变体、8 个共同方法更新、21 个操作文本更新和2个专用方法替换形成34项新来源；此前78项保留，共112项来源资源。来源编号只追溯，不把全部提示词注入请求。

## 本轮增强

- 真实样稿匿名比较与质量回归。
- 作者日常选择与改稿的可撤销偏好证据。
- 探索草稿、单角色回合、回退与候选转换。
- 截止当前位置的初读诊断和阅读体验投影。
- 跨章跨卷剧情解决方式比较。
- 依实际必要资料放行的自由工作流。

初读使用独立 reader_prefix 总控和方法；人物回合使用 character_turn。共同方法替换必须真实发生，完整请求、工具、缓存和错误反馈均需隔离。宿主私有证明不发给模型。模型统计解释不能改写宿主计算的读者数、分母和胜负平。

## 实施约束

registry 中所有包 active=false，adapter unavailable；SKILL.md.template 是产品资源模板，不是已安装的个人 Skill。必须实现真实 schema、adapter、授权、验证、上下文和迁移后才能启用。inputKinds 与 validatorIds 是设计绑定名称，不能凭字符串当成功能完成。

正常三方向保持一次请求。试演、初读、偏好提炼和评测按需计费；打开图、切章、回放、拖布局和本地记录不调用模型。正文与核心记忆同版采纳；可选阅读与解法投影允许独立失败和重建，不能绕过核心要求。

## 验证状态

40个V6案例仅定义，行为执行数为0，包含14本地合同、9应用集成、11模型输出、6真人盲评。V5的32例与V4的36例保留原状态。本轮执行的是目录、类型、引用、来源哈希、装配选择、历史保留与文档排版验证；没有运行付费写作模型、真人盲评、百万字实际应用或Windows发布。

代码无解释性注释，说明在文档中。应用写作总控与仓库开发 AGENTS.md 分开，Codex按当前实际HEAD实施并验证。
