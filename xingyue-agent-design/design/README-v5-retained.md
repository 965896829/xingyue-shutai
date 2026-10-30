# 星月书台自由创作与动态世界设计包 V5

基线：965896829/xingyue-shutai 0.4.82，提交 b505f6f459db74871f39f63acf6106b827c8a353。2026-10-29 重新核验。V5 是设计版本，尚未接入应用，未修改远端仓库。

## 阅读顺序

1. 配套 Word 报告与 design/world-platform-architecture-v5.md：当前整合方案和本轮提示词全文。
2. runtime/agent.v5.md、design/skill-catalog-v5.md：总控与 19 个包、42 个操作的完整指引。
3. vnext/world-contracts-v5.ts、world-modules-v5.json：分类、作者继承、多套体系、标题证据、承诺、实时投影与语义修改合同。
4. vnext/skill-catalog-v5.json、skill-runtime-v5.ts、skills-v5/registry.design.json：目录、类型与不可激活的注册蓝图。
5. data/fanqie：336 个公开阅读选项、154 个旧 ID 映射、5 个官方榜单的 10 本小样本证据。
6. design/long-memory-v3.md、character-mind-v3.md、data-contracts-v3.md：继续生效的百万字记忆和人物语义。
7. design/implementation-backlog-v5.md：按依赖排列的实施步骤。
8. evaluation/platform-world-v5-cases.json、audit/verification-v5.json：32 个待执行案例与本轮实际验证范围。

## 版本关系

V5 接入题材、世界、书名证据和交互画布，不替换 V3 的来源、四种时间、人物信念、范围查询、读集、分支与事务语义。V4 按需技能装配继续使用，新增 world-design.profile、inherit、stress-test 三个可选操作。V2 的共创、试写、人物声音和文风修订保留。

旧 57 项提示和职责资源逐字保留，V5 新增 21 项来源资源，共 78 项可追溯内容。sourcePromptIds 只用于追溯，不能再次注入全部旧资源。新任务加载 V5 总控、一个技能共同方法、一个操作和必要上下文；在途任务继续原版本，两个总控不叠加。

## 作者自由与平台范围

创作画像允许混搭、自定义或暂不归类。平台发布选择独立核验，不能将单一主分类要求变成作品内容限制。公开书库、公开榜单、作者阅读标签、作者内容标签分别保存来源和范围。

本轮公开阅读目录为男频 154、女频 182；共 336 个频道选项和 40 个频道主分类入口。榜单目录为 37 个频道入口，不与书库强行对应。328 个本地内容标签没有被重新标成已完整核验的官方后台目录。

十二个世界模块全部允许未定或停用，也允许自定义。一本作品可以有多套成长体系；作者原文、名称、顺序、规则和字段锁保留。能力、境界、职业资格、社会地位分别建模。

## 蓝图使用

vnext/skills-v5/blueprints 内的 SKILL.md.template 是产品资源模板，不是已安装的个人 ChatGPT Skill。真实 schema、adapter、授权和验证器实现后，产品构建流程再生成运行资源。注册表全部 active=false、adapter unavailable。

19 个包有 42 个操作。packaging.review 按 entity_name、book_title、blurb 解析三种绑定，共 44 条注册记录；各绑定只追加该对象需要的输入和验证器。实体名审核不要求书名榜单或包装承诺。

分类 JSON 为研究证据快照，需规范化后进入 PlatformTaxonomySnapshotV5；并非已安装的动态配置。来源摘要的字节口径见 audit/public-evidence-verification-v5.json。

## 请求与可视化

三方向正常路径仍是一轮生成，轻量模块判断复用该请求。已有体系整理、规则压力测试和市场研究按需要调用。人物与记忆保持章后一次批量提取，并复用原独立审核位置。技能数量不等于模型请求数量。

图谱、人物卡与曲线读取同一版本的事实投影。打开面板、切章、筛选和拖动布局不调用模型；语义修改通过 ChangeSet。预览、候选、正史分开，世界与标题依赖失效沿来源及查询范围处理。

## 验证边界

当前验证包括目录与真实 JSON 类型、来源与哈希、57 项旧资源保留、官方资料数据一致性和报告排版。V3 的局部合成查询原型与 V4 验证保留其历史执行范围，不冒充 V5 应用测试。

32 个 V5 案例与 36 个 V4 案例均是待执行评测定义。没有运行付费模型、真人盲评、百万字真实小说端到端、Windows 发布或生产迁移。独立交互示意仅用于本轮对话，未打包为已接入应用。

交付代码不含注释；工程解释、迁移与来源放在文档中。audit/verification-v5.json 和 manifest.json 记录最终验证与文件摘要。
