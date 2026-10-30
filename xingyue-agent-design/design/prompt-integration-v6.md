# V6 提示词装配说明

本文件说明 research/v6-prompt-updates.json 的合并方式。它是星月书台的产品资源设计，未安装任何个人 Skill，未修改应用或远端仓库。

## 内容与计数

保留 V5 的 19 个技能包和原有 42 个操作，增加 6 个操作，得到 48 个操作。书名审核的三个 targetKind 绑定继续存在，因此在没有其他额外目标绑定时共 50 条注册绑定。

本次提供 3 个运行总控、8 个技能共同方法更新、21 个操作文本更新及 2 个操作专用共同方法，共 34 个独立文本单元。21 个操作中有 15 个既有操作更新与 6 个新增操作。作者总控 851 个 Unicode 码点；初读与人物总控分别为 393 和 365 个码点。操作正文为 152 至 194 个码点。此处是文本字符口径，不是 token，不包含工具 schema、具体上下文与宿主拼接文字。

## 六个新增操作

| 技能操作 | 视图 | 运行总控 | 输出种类 |
| --- | --- | --- | --- |
| co-creation.rehearse | scoped_pov | character_turn | rehearsal-turn-candidate |
| chapter-draft.explore | author_design | author | exploration-draft-report |
| voice-calibration.learn-edits | author_design | author | preference-learning-candidates |
| chapter-review.first-read | reader_prefix | reader_prefix | first-read-report |
| canon-audit.patterns | author_review | author | plot-pattern-review |
| reader-feedback.compare | author_review | author | quality-comparison-model-result |

新增操作统一只申请 candidate.submit。初读和单人物回合在最小实现中不开放检索工具，必要资料由宿主事先编译；若未来增加补检索，必须以相同可见范围执行并重新评估权限。输入缺失可返回明确缺口，不以读取完整作者库补齐。

## 既有操作增强

更新 concept-forge.create 与 regenerate，保护作者选中的独特点，同时保留恰好三案及冻结范围。

更新 story-contract.build，以同次方案生成输出阅读目标卡。ReadingTargetBriefV6 应表示作者已有描述与可为空的旧卡，不要求先完成一张目标卡，也不产生额外分类或阅读画像请求。

更新 co-creation.propose，将硬锁、偏好与探索授权映射到已有变更流程。

更新 rolling-outline.volume、batch、scene-contract.plan 与 chapter-draft.draft，按需要使用阅读推进、相关旧解法和本场声音素材。

更新 voice-calibration.update，使实际选择和已采用编辑偏好有范围地进入当前档案；learn-edits 只提炼候选，不直接激活档案。

更新 chapter-review.review、revision.voice 与 local，保留五项审阅合同，用故事依据、场景详略和表达来选择修复方式，不新增机械评分维度。

更新 memory-delta.extract 与 memory-review.review，明确可选阅读和解法投影不能替代核心状态；旧世界与人物语义继续生效。

更新 reader-feedback.analyze，连接当前阅读轨迹但保持真实反馈与模拟诊断分离。

## 合并规则

operationUpdates 中 isNew=false 的 inputKinds 与 validators 已由 V5 原列表加新项合并，是完整替换列表，不能再以重复拼接注入。未提供的既有字段保留，包括输出种类、已有 targetBindings、能力边界和来源历史。

isNew=true 的操作具有完整标题、指令、输入、输出、能力、验证器与上下文视图描述。所有新增及受合同影响的操作应标记需要 V6 adapter，注册仍 active=false、adapter unavailable，直到真实 schema、适配器、宿主验证和界面路径完成。

runtimeCoreVariant 只选择一个总控。coreInstructionsOverride 存在时替换该技能共同方法，不与原共同方法叠加。首次初读绝不能装入普通 chapter-review 的五项检查方法；单人物回合也不能装入作者视图的共创资料。

## 可见信息由宿主保证

初读和人物回合的隔离必须覆盖完整请求：system 与 developer 动态内容、用户资料、工具参数和说明、schema 的示例与枚举、文件名与附件标题、历史消息、检索结果、摘要和缓存。模型可见的包只含经过过滤的 payload；私有证明、来源全表、隐藏约束或过滤理由不整体序列化给模型。

first-read 只接 ReaderPrefixPacketV6 和安全 FirstReadTaskV6，不接完整 AuthorContract、未来大纲或作者真相。ReaderPrefixPacketV6 的覆盖状态须说明是完整已提供前缀或节选；可见来源封闭为正文、可见标题及本次确实呈现的书名简介，不装入作者摘要、未来大纲或状态总结。不能把有限资料下未看到的信息判成原文遗漏。

rehearse 只接指定人物包、安全 CharacterTurnTaskPolicyV6 和安全回合条件。完整 CreativeTaskPolicyV6 中的硬锁可能包含隐藏真相，不能直接作为角色输入。未公开硬锁由宿主私有检查，错误回执也不能泄漏隐藏原因。

原始作者导演要求先在宿主私有侧处理；人物回合只接经过过滤的 actor_safe_direction、世界内可观察动作或对白，安全导演要求也不自动成为世界事件。单人物回合只控制一个角色；其他人的行动与世界后果等待宿主或作者裁定。导演式全场景创作由 chapter-draft.explore 承担，不宣称作者全知上下文是角色隔离模拟。

## 探索与正式采纳

探索入口允许空的初始正史快照以及不完整的大纲、人物和世界；必要上下文由本次范围决定。获授权的重要新增与原意变化与小说文字分开，结果留在探索分支。

选中试演只产生采纳候选或变更，不等于整段成为发生过的历史。合并时核对当前版本、作者选择与依赖，必要时重新提取同版核心记忆。未选分支不参与正式检索和人物状态更新。

## 可选投影的失败隔离

阅读推进与解法记录优先从已有场景、事件和章后增量派生。模型只在宿主启用独立可选载体时补充有来源的投影候选，不能为其另起默认逐章或逐角色请求。

失败隔离应由独立 framed payload 或已成功解析的 envelope 子载荷验证实现。可选子载荷缺失、来源不足或 schema 校验失败，可以丢弃并显示待生成；整份 JSON 语法损坏、截断或核心证据失败仍需真实恢复，不能宣称此时也一定能无损提取核心记忆。

核心正文与记忆同版采纳继续保持。可选体验解释不得伪装成真实读者心理，剧情解法记录不得成为第二套正史。

## 偏好与比较

原始选稿和编辑事件可以本地记录，语义提炼按需执行。事实纠错和未知理由不自动成为文风规则；候选适用范围遵循当前作品、人物、场景和单次授权。证据撤销后，相关候选及已启用档案须通过来源依赖进入重新核验，不能只在界面隐藏旧记录。

reader-feedback.compare 的模型输出直接映射为 QualityComparisonModelResultV6，只含 conclusions 与 proposedNextExperiment。宿主把它与不可修改的 QualityComparisonHostSnapshotV6 组装为最终报告；样本纳入排除、分母、分层、计数和统计版本均来自宿主，模型不能重算、重报或覆盖。compare 分析真实匿名选择与宿主统计，不替读者投票，不生成模拟样本。读者来源、首次与重复暴露、呈现顺序、平局、都不满意、缺失记录以及模型和预算差异均保留。开发集与保留集分开，作者偏好与目标读者偏好分别报告。

## 待对齐事项

初读实际模型提交内容应使用 FirstReadModelResultV6，单人物回合使用 CharacterRehearsalModelResultV6；宿主随后绑定私有证明、持久身份、版本、分支与哈希生成正式候选记录。模型只引用实际提供的来源别名、请求别名及可见观察标识，不能被要求复述或编造不可见 ID、版本或哈希。验证器中的版本与 hash 校验由宿主完成，不代表要求模型把私有字段输出一遍。

JSON 中 inputKinds 和 validators 是待实现能力的逻辑名称，不是运行时 schema 或当前函数名。主包应统一到 V6 TypeScript 合同和适配器映射；无法对应的名称应明确列为宿主待实现职责，不能仅有字符串便宣布功能已可用。

旧操作、旧任务及旧存储继续使用原版本恢复。V6 源资源用于追溯，实际请求只装一个总控、一个共同方法或替代方法、一个操作与必要上下文。

输出种类 quality-comparison-model-result 是目录中的逻辑标识，实际模型结果映射为 QualityComparisonModelResultV6；模型不得返回完整持久报告或重写宿主统计。
