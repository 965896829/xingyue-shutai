# V6 创作与质量合同说明

V6 在 V3 的来源、四种时间、读集与分支上增加创作授权、探索草稿、声音偏好证据、阅读体验和质量对比。V5 的世界、分类、包装承诺与可视化合同继续有效。本文件中的 TypeScript 是待接入的设计合同；它没有数据库迁移、运行适配器或模型效果保证。

## 类型与操作对应

| 操作 | 主要输入 | 主要输出与宿主记录 |
| --- | --- | --- |
| co-creation.rehearse | CharacterTurnTaskPolicyV6、CharacterTurnPacketV6 | CharacterRehearsalModelResultV6，经宿主绑定版本形成 CharacterRehearsalTurnV6 |
| chapter-draft.explore | ExplorationTaskV6 | ExplorationDraftV6 |
| voice-calibration.learn-edits | PreferenceLearningPolicyV6、PreferenceEvidenceV6 | PreferenceLearningCandidatesV6，具体条目为 PreferenceHypothesisV6 |
| chapter-review.first-read | ReaderPrefixPacketV6、FirstReadTaskV6 | FirstReadModelResultV6，经宿主绑定上下文证明形成 FirstReadReportV6 |
| canon-audit.patterns | PlotPatternProjectionV6、待写场景与当前授权 | PatternComparisonV6 |
| reader-feedback.compare | BlindComparisonEvidenceV6 | QualityComparisonModelResultV6，仅解释证据；宿主结合固定统计快照组装 QualityComparisonReportV6 |

ReaderPrefixPacketV6 与 CharacterTurnPacketV6 仅指可发送给模型的 payload。CompiledScopedPacketV6 是宿主内部对象，另含 hostPrivateProof；不得对它整体 JSON 序列化后发送。FirstReadObservationV6 和 CharacterRehearsalTurnV6 是保存后的记录，含宿主追加的内部任务、版本与 hash，不是要求模型猜填的原始工具参数。实际工具 schema 只暴露对应 ModelResult 类型中的可见字段。初读 finding 的持久 id 由宿主分配，FirstReadFindingModelV6 去掉这个内部字段；模型只返回已知来源别名及文本证据。reader-feedback.compare 同样只返回 QualityComparisonModelResultV6 的结论和下一项实验建议，不返回包含样本统计的完整报告。完整 CreativeTaskPolicyV6 可能包含作者秘密，只能留在宿主或作者视图；角色回合只接收 CharacterTurnTaskPolicyV6，初读只接收 FirstReadTaskV6。未公开作者锁的校验与修复反馈都由宿主保留，返给模型的错误只能使用该包已可见的信息。

同一书的完整场景试演走 chapter-draft.explore。co-creation.rehearse 只执行单个角色的一回合，允许作者扮演另一角色；多角色独立回合需要分别装配上下文并计费。不能把作者全知场景的单次生成冒充各角色上下文已在物理上隔离。

## 与 V3 和 V5 的桥接

WorkBaseV6 使用 existing_work 或 initial_work。前者直接继承 MemoryQueryScopeV3 和 ReadSetV3；后者保存创建快照及作者输入版本，acceptedProse=false、narrativeScope=null，适用于尚无正文的新作品。初始作品允许已存在明确作者设定，但不能伪造已经发生的场景、正文事实或故事时间。转入既有工作流时，适配器必须显式建立起点和身份映射，不能给未写章节编造一个“已采纳”来源以满足旧字段。

CreativePositionV6 对已安排的场景使用 NarrativePointV3 和 StoryWindowV3，对尚未确定章序的片段使用 provisional。片段被编入正式章节后重新解析位置与来源。V3 的人物获知事件继续表示角色何时得到信息；编辑版本和快照继续表示作者何时改变作品。故事发生、叙述揭示、人物获知、编辑记录四个时钟不能互相代替。

来源直接复用 TextSourceSpanV5，保留 UTF-16 与 Unicode 码点的单位标记、半开区间和正文 hash。模型可见的局部引文统一采用 Unicode 码点，并通过不带语义的 sourceAlias 映射回宿主原始来源。宿主比较引文时先使用实际编码转换，不能把 JavaScript 字符串索引直接当码点位置。

阅读体验与剧情解法记录都是派生视图，沿用 ReadSetV3 的原文、事实、对象、谓词和空结果依赖。它们不进入原始事实提取队列，也不能反过来成为事实唯一来源。ProjectionWatermarkV5 的序列域、范围哈希与连续水位继续约束界面；投影失败不免除原正文与核心记忆同版采纳要求。

V6 新任务使用新增 operation、静态总控变体、方法替换、schema 与适配器。在途 V3 至 V5 任务继续冻结版本恢复。未实现能力保持 design_only 和 adapter unavailable。新增六个操作仍属于原有十九个技能包；原有书名审核三种目标绑定继续存在。

## 十五条宿主不变量

### 1 项目和基线必须匹配

输入、授权、候选、证据、反馈和目标对象必须属于声明的项目与有效分支。existing_work 同时校验 headRevisionId、snapshotHash、overlayManifestHash 和读集；initial_work 校验 creationSnapshotHash 与作者输入版本。修改或采纳使用当前目标的 compare-and-swap，不能仅凭可读书名或文件路径匹配。

验收要包含同名书、同名人物、已变化的主分支和旧输入创建快照。合法的空作品可以探索；旧基线必须标记待重新核验。

### 2 每条引用必须对应实际字节和坐标

校验正文版本、bodyHash、区间边界、编码单位、引文和 quoteHash。模型引用仅能使用宿主提供的 alias。emoji、组合字符及 Windows 换行应在固定归一化策略下复现；原始存储正文不能为了让引用通过而悄悄改写。

### 3 作者授权不能由模型声明扩张

hardLocks、preferences 与 explorable 分开处理。明确修改旧锁需要对应作者决定；当前任务可沿用已存在授权，不要求重复确认。模型提交的 allowanceId 必须属于本轮有效授权，关键新增前提和依赖一起申报。ExplorationDraftV6 用 additions 保存新增，用 intentChanges 分别保存原内容、原来源、候选内容和授权；调整不能只写在新增项的布尔字段里。选中结果时，新增与原意调整分别选择并共同检查依赖闭包。普通细节按既定授权处理；“自由发挥”不成为绕过其他明确锁的理由。

### 4 工作流只检查本次实际依赖

探索草稿不要求先完成全书人物表、世界百科或完整卷纲。宿主针对本次操作计算必要资料，缺少的非必要项可以保持未定；缺少真正会改变本场成立条件的内容时才标出局部缺口。正式采纳、后续连续写作和核心记忆仍执行其实际必要门槛。

### 5 探索分支永不自动推进正史

试演基于固定父快照，局部人物使用独立身份命名空间。回退、分叉和删除候选不能删除正式历史或改变其他分支。旧分支可以继续查看；父基线或依赖改变后，合并必须重新核验。导演指令与世界内动作、台词分开，作者说“演一下他知道真相”不自动成为正式获知事件。原始导演指令可能包含作者秘密，必须留在宿主；角色包只接收经过宿主筛选的 actor_safe_direction，使用安全指令别名，并把过滤与来源映射记入私有证明。

### 6 选中试演先准备候选变更

CandidatePromotionRequestV6 只准备可审阅的 ChangeSet，不能直接写正式记忆。采纳前校验选中新增设定的依赖闭包、局部身份映射、目标版本、作者锁与结果。编入章节或修改文字后，以最终正文重新提取记忆；不能复用旧试演正文的增量。最终沿 V3 正文与核心记忆同版事务提交。

### 7 单角色试演的全请求都服从人物知情

character_turn 使用专用静态总控、专用方法和单角色 payload，不叠作者总控。角色可以得到自己的信念与明确观察，但看不到作者层的真假判定。试演中新的获知来自当前分支可见事件，绑定候选版本；他人隐藏想法不因多人同场就开放。对白中的猜测、欺骗和反问不是世界事实。

### 8 初读隔离必须覆盖所有模型可见表面

reader_prefix 使用专用静态总控和方法，包含实际呈现的正文、标题或简介；未呈现的包装不加入。宿主检查 system、共同方法、操作提示、工具名与 schema 描述、历史消息、附件标题、摘要、检索结果和 provider 会话。任何一处都不能夹带未揭示真相、作者期望答案、私有问题名单或带语义的内部 ID。

私有证明记录各表面 hash、来源白名单、可见截止、缓存命名空间和实际请求 hash。证明字段本身也不得发送。必须从可信宿主日志重算这些值，不能相信模型或调用方自填 verified_by_host。可以改变隐藏真相而保持可见前缀不变，验证实际发送的语义请求不被隐藏内容影响。

### 9 初读范围和额外成本必须真实

ReaderVisibleSourceV6 仅允许正文、已经呈现的标题与简介、可见章节标题；CharacterVisibleSourceV6 仅允许人物观察、信念和表达资料。实际 schema 对来源 kind 使用各自封闭枚举，不能共用一个过宽的来源 schema。完整前缀、选择片段与部分上下文分别记录；片段诊断不能宣称完成全开篇审查。包不合法时宿主先拒绝调用；模型收到的信息不足时可返回 insufficient_prefix。初读是可选独立任务，不能暗中成为每章固定请求，也不能把作者全知审稿重新标成初读。provider 必须使用全新无状态请求或可证明仅有相同范围内容的会话，不能沿用作者会话的 response ID。

### 10 原始偏好证据不等于全书规则

编辑原因未知时保持 unknown；模型推测只进入 hypothesis 和 alternativeExplanations。AI 修改未经作者接受，不当作作者偏好。事实纠错和情节改变不能直接学习为文风禁令。范围按当前场景、人物、本书或作者明确指定的跨书目标保存，叙述者和角色声音分开。

### 11 偏好启用和撤销具有来源闭包

原始选择和改稿可以在既有设置授权范围内记录，无需每次弹窗。启用更广的规则需匹配 PreferenceLearningPolicyV6 的有效授权，记录前后档案版本与 ChangeSet。撤销证据后，依赖它的假设、已启用规则、缓存和 VoiceSlice 进入待核验；不得继续把已撤销样例当正例。撤销不自动改写已有正文。

### 12 阅读轨迹不把意图和推测写成读者事实

正文已提供的信息、作者计划、模型体验推测、真实试读反馈分别使用 ReadingExperienceBasisV6。计划兑现不能标为正文兑现；模型认为“读者会很爽”不能标为真实情绪观测。具体判断绑定引文和当前位置。改变旧章会使相关轨迹失效，未知与未观察保持空缺。

### 13 重复检查提供证据而不强制改剧情

PlotPatternRecordV6 仅是有正文依据的派生解释。当前场景与历史记录比较时必须给出双方证据，保留检索范围；有界候选未命中不能证明全书没有重复。没有历史时返回空集合和适用范围，不强行制造相似场景。有意义的回响、同一能力的新条件、承诺兑现及作者明确偏好均允许存在。修改建议仍受本轮授权限制。

### 14 对比实验保持实际可比性

声音比较固定事件与结果，情节比较记录允许变化，连续工作流比较记录链上版本和范围。宿主核对实际模型配置、提示、输入、长度与预算，不能只保存计划中的控制变量。多个因素同时变化时报告 combined_change，不把全部收益归给某份提示词。

匿名排列的映射、模型标签与随机种子保存在宿主私有绑定中。记录参与者此前是否看过该样稿，区别首次阅读、两稿比较和修订复测；作者自己的选择不冒充无先验目标读者的首读。有效反馈可以是胜、负、平、两者都不满意或弃权。

### 15 反馈汇总和运行记录由宿主计算

真实作者、目标读者与模型模拟按来源分层，去重、排除撤回、计数、胜负平及样本口径由代码确定。reader-feedback.compare 只解释给定证据，不能补造人数、读完率、市场结论或显著性。样本不足或条件不可比是合法报告状态。

比较时先固定 QualityComparisonHostSnapshotV6 及统计版本/hash。模型结果 schema 拒绝 includedObservationIds、strata 等统计字段，宿主只合并结论与下一项实验建议；反馈或统计快照发生变化则标 stale，不使用新数字悄悄替换旧模型解释。QualityComparisonAssemblyReceiptV6 记录这一绑定。

运行失败、取消、结果未知和部分产物如实记录；没有候选时 candidateVersion=null，不能填一个虚构版本。调用、token、费用和延迟来自实际记录，未知保持 null。新增功能的测试定义、静态合同检查、真实模型实验和真人盲评分别报告，不能互相替代。

## 建立阅读目标时的可选输入

story-contract.build 接收 ReadingTargetBriefV6，允许 null、作者描述或旧卡中已有的部分值，并在同次作品方案生成中形成 ReadingTargetCardV6。不能把完整阅读目标卡作为建立作品方案的前置，否则会产生先有输出才能调用生成的循环。未知内容可以保持提案，既有作者明确要求继续优先。

## 附属阅读和解法数据的独立验证

NarrativeSubmissionEnvelopeV6 保留原核心结果 core，adjuncts 可以缺省。readingExperience 和 plotPatterns 分别按 ReadingExperienceAdjunctPayloadV6、PlotPatternAdjunctPayloadV6 解析和验证，绑定同一正文版本。原始 JSON 能解析后，再分别校验核心、阅读数据和解法数据；附属 schema、引用或来源校验失败时，validatedPayloadHash=null，并记录独立状态，核心有效结果仍继续原有工作流。

如果整份 JSON 语法不能解析，core 标为 unavailable_due_to_transport，整个核心流程停止，不能声称附属字段可选就能从残损 JSON 中可靠恢复正文记忆。核心失败时，附属候选也不进入正式投影。核心通过此处局部验证只表示继续既有审核与采纳，不替代核心记忆独立审核、作者采纳、同版事务或水位要求。NarrativeSubmissionValidationReceiptV6 明确允许 core 有效且一项或两项附属数据失败，这些是设计合同，尚需实现真实解析器和适配器。

## 工程验证建议

先实现 JSON schema 与实际适配器，再对每条不变量构造正反案例。最关键的回归包括初始空作品、旧版在途恢复、隐藏信息从工具 schema 或会话缓存泄漏、角色误信、试演分支回退、部分选中依赖不完整、编辑证据撤回、只改剧情却被学习为文风、无历史重复检查、匿名顺序与重复曝光、真实反馈与模拟反馈混入统计。

这次只验证 TypeScript 语法与严格类型：合同在隔离镜像中通过 strict 和 noUncheckedIndexedAccess。没有连接生产适配器、运行付费模型、生成真实小说或执行真人实验；行为案例需要在对应功能实现后运行。
