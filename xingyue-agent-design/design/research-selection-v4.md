# V4 内置 Skills 工程研究

核验日期：2026-10-29。任务范围为用户自创网文 Agent 的技能工程机制；不建议为接入 Skills 更换现有 Pi / TypeScript / SQLite 主栈。本文件的「采用」与「不采用」是面向本项目的设计判断，不是上游性能承诺。

## 1. 结论

采用 Agent Skills 开放文件结构；扩展本项目自己的注册表、阶段路由、工具权限和版本快照。借鉴 Anthropic Skill Creator 的有技能/无技能配对、触发正反例、盲评和成本分析；借鉴 LangGraph 的持久任务边界与幂等恢复。继续使用本项目已依赖的 @earendil-works/pi-agent-core / pi-ai 1.4.0，不因为当前 Pi coding-agent 有技能功能就假定两个低层包自动提供其全部发现、激活、插件机制。

Skill 是可复用的任务方法与资料包。Tool 是执行动作的接口。Host Service 保证事务、权限、记忆可见性、索引与版本正确。Subagent 是独立上下文和模型执行任务。四者应分别定义、分别计费和观测。

## 2. 核验来源与采用决策

| 来源 | 截止本次核验的状态 | 采用机制 | 本项目决策 |
| --- | --- | --- | --- |
| Agent Skills 标准 | 官方规范和实现文档持续维护；规范仓库 Apache-2.0；本次未取得 main 精确 SHA，不宣称固定语义版本 | SKILL.md、name/description、引用资料和脚本的分层加载 | 直接采用可移植文件格式；业务契约放本项目扩展 manifest，不冒充开放规范 |
| Pi | badlogic/pi-mono 已重定向 earendil-works/pi；v1.4.0，2026-10-21，4a08025；MIT | Skill 提供专门指引；Extension 提供可执行集成；资源单独打包 | 保留现依赖；参考同版 coding-agent 的分层思想，自有宿主实现工具与技能控制 |
| Anthropic skills / skill-creator | 当前官方 main 有触发评测、基线、盲评和迭代；skill-creator 许可证 Apache-2.0；仓库部分文档技能另有 source-available 条款 | 效果、路由、时间和 token 成本一起比较 | 借鉴评测流程，原创网文技能；不要整仓复制所有文档技能 |
| Claude Agent SDK TypeScript | v0.3.312，2026-10-27，e296380；SDK 由 Anthropic Commercial Terms 管理，并非整体 MIT | 会话技能名单、名称分派、工具权限与技能权限分离、生命周期观测 | 仅借鉴显式作用域；不为 Skills 再叠一套模型执行宿主 |
| LangGraph JS | @langchain/langgraph 1.5.3，2026-10-26，b09eb06；MIT | task/checkpointer、恢复重用已完成结果、失败任务幂等 | 借鉴执行语义到现有 journal/outbox；不增加双任务状态机 |
| SkillsBench | 官方 v1.1 固定 87 任务、8 领域，2026-06-14 release；6月16日发布说明；Apache-2.0 | with/without Skills 成对实验与可复现任务、verifier、轨迹 | 用于设计自己的中文网文基准，不用通用领域排行榜推断小说质量 |

版本信息用于此次对照，不表示要求升级依赖。Skill 标准只定义包装与发现的一部分，并不替代本项目的项目授权、正史采纳和模型网关。

## 3. 值得落实的工程结构

### 3.1 三种加载路线

固定工作流阶段由宿主根据 workflowVersion + phase 选择技能和操作，不额外调用模型判断是否需要当前阶段技能。对象共创模式由选中对象和用户动作缩小技能候选集；有歧义再让当前模型在可用目录中选择。用户显式选择技能直接分派，但仍受宿主当前项目、分支和阶段能力边界约束。

一次任务载入一份总控、一个主技能、当前操作的指引与必要资料；原本能够单轮提交的三个方向保持单轮正常路径。不要先调用模型解释应该用什么技能，再另起一个模型读技能，造成没有业务收益的固定链。

### 3.2 可移植标准与项目扩展分离

SKILL.md 使用标准 name、description 与精简方法。需要的参考文档通过相对引用按需装配。JSON Schema、工作流阶段、读写范围、工具集合、验证器、候选结果类别、预算策略和宿主版本要求放进本项目 manifest。这里的 manifest 属于项目自定义协议。

不要把复杂 JSON 嵌进标准 metadata 的值；规范要求 metadata 的键和值为字符串。allowed-tools 仍是实验字段，支持依宿主而定。即使某 SDK 支持 allowedTools，也可能只代表预批准，不能当成排除其他工具的访问控制。

### 3.3 宿主提供能力，技能描述方法

记忆检索、权限裁剪、Unicode codepoint 证据定位、哈希校验、原子采纳、角色状态物化、依赖失效、事件重放、索引和可视化订阅都由宿主服务实现。技能可以调用窄接口或接收预编译数据，不能靠「请勿泄漏未来事实」替代实际的视角过滤。

每个独立模型执行的工具集合应取宿主允许集合与当前阶段集合，再根据任务需要进一步收窄。写技能的文本不获得额外文件、数据库、网络或命令权限。新增加的脚本属于软件组件；模型引用脚本路径不构成自动运行授权。

### 3.4 技能快照与恢复

任务开始绑定技能版本、正文哈希、参考资料哈希、输出 Schema 版本、工具适配器版本、模型配置和 read-set digest。进行中的章节继续使用原版本；升级只影响后续新任务，或由显式迁移创建新任务。

已有完成模型结果应由恢复记录重用。未完成且结果未知的远程调用必须遵循当前网关恢复策略；不能因队列租约过期就重新请求模型。重放只能重做可幂等的宿主动作，不能把尚未证实安全的外部副作用统称为 exactly-once。

### 3.5 上下文压缩与去重

用 skillId + digest 标识已装载内容。压缩保存当前任务仍生效的技能与操作约束；下一任务从原始版本资源重组，不依赖旧对话摘要记住任务规则。已结束任务的技能不永久常驻小说写作上下文。

规范推荐保护技能上下文和去重，本项目将其限定为「当前活动任务」，避免长篇写作中积累所有历史阶段指令。

### 3.6 技能改进机制

将用户采纳、拒绝、撤销、句段修改和明确偏好保存为带来源、作用域和版本的产品数据。先更新本书 VoiceProfile 或作者偏好；技能指令改写必须经过离线评测和版本发布，不在用户写第300章时偷偷替换全局规则。

角色状态不是技能源码；一本书的事实不是技能通用知识；用户的临时修改也不自动变成全局偏好。这些边界是避免跨书污染和记忆膨胀的关键。

## 4. 评测与发布

至少分四组，分别报告结果：

1. 路由：固定阶段是否命中正确操作；共创意图正例、反例、边界相邻技能；显式点选是否正确进入相同工作流；禁止越权和隐藏技能调用。
2. 宿主契约：输出 Schema、版本与源证据、局部冻结、未知结果恢复、用户部分采纳的依赖完整性。
3. 文学效果：同创意、同模型和预算下比较 V3 与 V4；作者盲评具体因果、人物辨识度、情绪行为一致性、段落自然度和继续阅读意愿。LLM 评分只作辅助。
4. 成本：实际模型请求数、工具轮数、输入输出 token、延迟分位数、格式修复率、重复加载量、无效检索量。

训练/调优案例与最终留出案例分开；触发描述优化不要用最终测试集挑选多个迭代后的最好版本，再把同一集合当无偏的最终效果。多次重复并报告方差。通用 SkillsBench 的提升值不能直接迁移到中文小说。

一条技能如果增加成本却没有改善质量或错误率，应缩减、合并或移出主线。固定工作流使用显式阶段路由，不需要把所有触发评测机械地套成大模型分类实验。

## 5. 不建议加入的东西

- 整包导入成百上千通用 Skills；当前网文产品的关键能力不依赖通用办公/运维菜单。
- 每个角色常驻一个独立 Agent；角色心智应由统一状态层 + 本章片段表达，触发反思才另开任务。
- 把检索、数据库审计、状态曲线绘制做成需要模型执行的常规技能。
- 每章默认调用市场搜索、原创性搜索、三套评委和反复自检。
- 安装第三方 Skill 即允许其 shell、HTTP、任意路径读写或自动更新。
- 以 skill 文件条数、GitHub stars、AI 检测分数证明小说质量。
- 重复引入 Pi、Claude Agent SDK、LangGraph 三个运行宿主来管理同一条章节链。

## 6. 一手参考

- SKR01 https://agentskills.io/specification
- SKR02 https://agentskills.io/client-implementation/adding-skills-support
- SKR03 https://github.com/agentskills/agentskills
- SKR04 https://github.com/earendil-works/pi/releases/tag/v1.4.0
- SKR05 https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/skills.md
- SKR06 https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/extensions.md
- SKR07 https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md
- SKR08 https://github.com/anthropics/skills
- SKR09 https://code.claude.com/docs/en/agent-sdk/skills
- SKR10 https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.312
- SKR11 https://github.com/anthropics/claude-agent-sdk-typescript
- SKR12 https://docs.langchain.com/oss/javascript/langgraph/functional-api
- SKR13 https://github.com/langchain-ai/langgraphjs/releases/tag/@langchain%2Flanggraph@1.5.3
- SKR14 https://github.com/langchain-ai/langgraphjs
- SKR15 https://www.skillsbench.ai/blogs/skillsbench-1-1
- SKR16 https://github.com/benchflow-ai/skillsbench/releases/tag/v1.1
- SKR17 https://github.com/anthropics/skills/blob/main/skills/skill-creator/LICENSE.txt

## 核验限制

已通过官方网页与 GitHub 页面核验以上机制。Agent Skills 与 Anthropic skills 的 main 精确 SHA 无法通过本次网页工具取得，未伪造提交日期。截止日期是本次检索日期，不是这些规范的发布日期。本文没有执行上游评测，没有安装这些依赖，没有修改用户仓库。

