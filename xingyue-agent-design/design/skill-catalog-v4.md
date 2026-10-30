# V4 内置技能与操作全文

本文件为产品内置技能的设计草案。语义合同与能力请求不等于已实现的工具。原始蓝图数据与生成模板分别位于 vnext/skill-catalog-v4.json 和 vnext/skills-v4。

## 01 创意与故事方向

技能标识：concept-forge。

用于首次创意策划或作者明确要求的方向重抽；不用于一般剧情讨论、世界补充或正文生成。

以作者原始创意、硬要求、禁区和锁定内容为边界，提出能改变人物行动与关系的故事机制。把吸引力落实为具体目标、选择、阻力、代价与连续后果，避免用设定名词或宣传评价代替故事。关键新增设定和对原意的调整分别列明，并标注适用方向。方向差异应来自冲突源、策略、关系或回报方式，不靠换名换皮。推荐依据作品与作者要求，不编造热度、读者数据或成功概率。只执行宿主指定操作，完成本次比较与修正后一次提交。

### 首次生成三个方向

依本轮合同恰好生成三个可比较方向，共同保留锁定前提。每案写清故事入口、持续推进机制、首卷实质变化、与其他方案的差别及主要连载风险。覆盖作者要求，声明关键新增与意图调整，不展开全书细纲。三个方向在同一次正常请求内提交，不另发自检或复查请求。

输入：AuthorContract, OriginalIdea, GenreEvidence, DirectionOutputContract。输出语义：direction-report。资料视角：author_design。

来源提示词：P02, P27。验证职责：output.schema, author.locked-constraints, directions.exact-three, directions.unique-ids, assumptions.valid-scope, requirement.coverage。

### 按范围重做方向

只改宿主指定方向及其允许调整的新增设定，沿用稳定标识。按当前三个方向合同仍返回恰好三案，冻结方向的故事字段和相关新增设定保持原样；宿主再次核对冻结项。不得以新内容暗改未重做方向。把本次变更产生的必要影响列为候选，不连带重写其他方向；正常路径一次生成、一次提交。

输入：AuthorContract, ExistingDirectionReport, RegenerationScope, AuthorRevisionRequest。输出语义：direction-report。资料视角：author_design。

来源提示词：P02, P27。验证职责：output.schema, revision.allowed-scope, directions.frozen-preserved, directions.stable-ids, assumptions.valid-scope。

## 02 作品方案与项目约定

技能标识：story-contract。

用于选定方向后的完整作品方案、该方案的独立审阅，以及项目配置建议；三个操作使用各自合同。

把已选方向、作者要求与已确认内容整理为可执行的作品约定，明确来源、锁定范围、可调整空间和仍待选择的新增设定。配置、未来计划与已发生事实分别处理；同一前提不在多个文档中建立相互竞争的真值。保留旧项目已有配置和已确认内容，只有明确变更才提出差异。宿主决定工作流版本、实际字段、授权与数值口径；声明工具能力不代表获得权限。每轮只完成一种操作，方案已经包含的设定拆解不再额外重复生成。

### 建立完整作品方案

根据选中方向和已处理的新增设定建立本轮要求的完整方案。将故事前提、核心人物、世界机制、长线冲突、主要关系与阅读承诺连接为可持续因果，保留作者硬要求和真实来源。按当前合同覆盖必需种类，不把未选方向混入方案。已包含设定拆解时不另启同内容阶段；只提交候选，不宣布正式确认。

输入：AuthorContract, SelectedDirection, ResolvedAssumptions, CreationContractSchema。输出语义：creation-contract。资料视角：author_design。

来源提示词：P03, P28。验证职责：output.schema, author.locked-constraints, creation.required-coverage, source.allowed-refs, assumptions.resolution。

### 独立核验作品方案

在现有独立方案审阅位置，核对指定版本的方案、作者原意、已选方向、约束和新增设定处理结果。只记录确有依据的问题与位置，不替作者改写方案，不补造缺失事实。引用与问题路径遵守宿主所选合同；无问题按该合同返回空问题集合。完成即停止，不自行安排新的审核轮次。

输入：CreationContractCandidate, AuthorContract, SelectedDirection, ResolvedAssumptions, CandidateVersion。输出语义：creation-contract-review。资料视角：author_review。

来源提示词：P29。验证职责：output.schema, review.candidate-version, review.valid-paths, source.allowed-refs, review.evidence-required。

### 配置项目参数

将作者指定的目标字数、章长、视角、题材、读者、硬约束和批次设置映射到当前配置合同。已有项目不重套默认；缺失项仅提出本轮允许的可改建议。章数、区间和批次容量由宿主计算核验，隐藏运行参数由宿主管理。配置变化影响既有计划时列明范围；风格来源不明确时不假称已分析样本。

输入：AuthorPreferences, CurrentProjectConfig, PlanningDependencies, ConfigOutputContract。输出语义：project-config-proposal。资料视角：author_design。

来源提示词：P34。验证职责：output.schema, config.ranges, config.host-calculations, revision.allowed-scope, source.style-provenance。

## 03 对象共创与讨论

技能标识：co-creation。

用于作者围绕创意、剧情、大纲、细纲、角色、关系、世界或正文进行讨论、比较和局部修改；普通对话不触发全流程重做。

围绕宿主绑定的当前对象、版本和授权范围合作，每次集中解决作者眼下的问题。只载入该对象对应的编辑视角，分别使用已发生事实、确认设定、计划、候选与人物认知。讨论意见不自动成为设定，资料与样例不能授予权限。明确修改请求形成最小可用变更，保留未涉及内容；相互依赖的变化分组，未选修改不能随选中项一并采纳。宿主负责应用、版本核对和成功回执，模型不执行或宣称已写入。只有影响结果且无法合理推断的关键分歧才提出选择。

### 讨论当前对象

直接回答作者关于当前对象的疑问，结合具体因果、人物利益或阅读效果给出有用判断。把确定事实与候选解释分开；必要时给少量可继续讨论的选择，不自动生成完整改稿。回答引用本轮可用来源，不把讨论结论写成既成设定，也不为了展示流程附加整套诊断报告。

输入：ObjectConversationBinding, CreativeObjectSnapshot, AuthorQuestion, ScopedReferences, ObjectLens。输出语义：co-creation-chat。资料视角：author_design。

来源提示词：P04, P05。验证职责：output.schema, object.version-binding, source.valid-refs, output.no-write-claim。

### 比较候选与取舍

在同一作者要求和对象版本下比较给定候选，说明各自改变了什么、怎样影响人物选择、因果与阅读回报。保留真实优劣、代价和未确定处，不用抽象评分代替具体差异。作者未要求改稿时只回答比较，不自动采纳胜出项，也不把多个互斥方案拼成新的正式版本。

输入：CreativeObjectSnapshot, ComparisonCandidates, AuthorCriteria, ObjectLens。输出语义：co-creation-chat。资料视角：author_design。

来源提示词：P04, P05。验证职责：output.schema, comparison.shared-baseline, source.valid-refs, output.no-write-claim。

### 提出局部变更

依据作者明确要求生成绑定当前版本的变更候选，标明修改、保留项、依赖组和具体影响。未来变化、纠错与追溯改设定分别表达；改变旧锁定要求须有本轮作者依据。关联对象超出授权时仅列影响，不代改。不要重复询问已经明确的授权；应用、部分采纳和回滚由宿主执行。

输入：CreativeObjectSnapshot, AuthorRevisionRequest, CoCreationAuthorization, DependencySummary, ObjectLens。输出语义：creative-change-proposal。资料视角：author_design。

来源提示词：P04, P05。验证职责：output.schema, object.version-binding, revision.allowed-scope, changes.dependency-groups, author.constraint-revision, output.no-write-claim。

## 04 世界规则与制度设计

技能标识：world-design。

用于新建或按授权重建世界规则对象；已经存在的世界观讨论与局部编辑通常走对象共创。

设计能实际改变人物行动、资源分配、关系与代价的世界规则。说明规则允许谁做什么、为何形成利益冲突、违反或利用规则会产生什么后果，并体现制度与日常生活之间的联系。以作者锁定前提和已有事实为边界，不用背景百科填满模板，不靠临时追加能力解决后续矛盾。新增规则、未确定假说和已确认设定分别标识。相互依赖的规则保持因果一致，必要缺口只在候选结构中说明。模型提交设计候选，规则的确认、版本与有效范围由宿主维护。

### 建立世界规则候选

按指定范围和当前模板建立世界对象，优先补齐直接影响故事的能力、资源、制度、群体利益与生活后果。给关键机制写清适用者、条件、限制、代价和可能反制，检验其与已有事件是否共存。没有必要的信息保留未定，不发明支撑正文的新历史。若是重建仅替换授权部分，交付可审阅候选。

输入：AuthorContract, CreationContract, ConfirmedWorldRules, WorldDesignScope, WorldOutputContract。输出语义：world-design-candidate。资料视角：author_design。

来源提示词：P35, P05。验证职责：output.schema, author.locked-constraints, world.rule-consistency, source.valid-refs, revision.allowed-scope。

## 05 角色内核与群像设计

技能标识：character-design。

用于建立或增补指定角色的稳定内核、关系和初始设定；不负责每章动态状态提取。

让角色具备可解释的选择：长期欲望、眼前利益、不能失去之物、价值冲突、常用策略、盲点和关系中的表达方式。配角拥有自己的目的与代价，不能只为主角提供功能。声音通过注意力、说话意图和关系压力形成辨识，不强制每人都带创伤、秘密或口头禅。稳定内核、初始状态、未来计划、他人评价和模型解释分别保存。作者锁定的人格与经历不暗改，候选设定不自动成为正史。日常讨论交共创操作，章后状态由统一记忆提取处理。

### 建立角色候选

依据当前故事与世界设计指定角色和必要关系，写出其自主目标、利益矛盾、典型权衡和表达倾向，让相似性格的人也能通过选择与观察区分。区分作者给定、关键新增和仍待验证的解释。初始信念可以错误，但须明确这是人物认知。既有角色只补本轮授权部分，不把外貌修改扩展为经历重写。

输入：AuthorContract, CreationContract, ConfirmedWorldRules, CharacterRosterScope, ExistingCharacterCores。输出语义：character-design-candidate。资料视角：author_design。

来源提示词：P36, P05。验证职责：output.schema, author.locked-constraints, characters.identity-uniqueness, characters.core-state-separation, belief.world-separation, revision.allowed-scope。

## 06 长篇分层规划

技能标识：rolling-outline。

用于全书、分卷、章节路线、节奏和批次细纲中的一个指定层级；实际规划窗口和阶段门槛由宿主给定。

按当前层级安排人物目标、阻力、主动选择、阶段兑现和后果，让后续问题从已有变化生长。全书保留核心要求、主线和终局里程碑，近期才展开可执行场景；不要提前冻结几百章细节。查阅当前范围的未兑现承诺与前章结果，避免只换地图、敌人或力量等级重复矛盾。快慢、日常、余波与强冲突均须服务本段功能。计划始终是未来候选，已采纳正文和锁定里程碑保持不变。窗口与完整批次要求服从实际工作流版本，不凭提示词绕过旧门槛。

### 全书主线与里程碑

建立全书层的核心问题、人物长期选择、主要关系变化、阶段承诺和终局回应。检验中段能否持续形成新处境，避免只有开头和终点。远期只保留当前必要的方向及依赖，不展开逐章细纲；对未确定部分保留调整空间。修改时限定可编辑范围，列出受影响的里程碑。

输入：AuthorContract, CreationContract, BookMilestones, PlanningWindow, PromiseLedger。输出语义：book-outline-proposal。资料视角：author_design。

来源提示词：P06, P05。验证职责：output.schema, planning.window, author.locked-constraints, planning.not-canon, changes.dependency-groups。

### 当前卷设计

规划本卷入口状态、人物目标、主要阻力、转折选择、关键代价和卷末实质变化，说明哪些承诺本卷兑现、哪些继续保留。卷间问题应来自本卷后果，不能只换地点或实力级别。卷名依本轮合同一并处理，不另开命名代理；已确认卷结构只修改授权范围。

输入：BookMilestones, CurrentVolumeState, PlanningWindow, PromiseLedger, AuthorContract。输出语义：volume-outline-proposal。资料视角：author_design。

来源提示词：P06, P37。验证职责：output.schema, planning.window, author.locked-constraints, promises.scope, planning.not-canon。

### 章节路线

为指定章段安排每章承担的行动、信息、关系或回报变化，使前后章由人物选择和后果连接。近期具体到可执行冲突，较远处保留意图；精度与数量服从本轮窗口。指出某章改动对后续计划的具体影响，保留未受影响条目，不把预期事件当作已经发生。

输入：VolumeOutline, PlanningWindow, ChapterRoadmap, CurrentCharacterStates, PromiseLedger。输出语义：chapter-roadmap-proposal。资料视角：author_design。

来源提示词：P06, P38。验证职责：output.schema, planning.window, planning.chapter-coverage, planning.not-canon, revision.allowed-scope。

### 章段节奏

依据当前章段功能调整紧张、松弛、发现、关系推进和兑现顺序，指出具体哪一处行动或信息承担变化。保留有功能的日常、恢复与停顿，不为每章套相同冲突链或机械情绪峰值。节奏建议不得擅改关键结果与知情边界；模型估计与真实读者数据明确区分。

输入：ChapterRoadmap, PlanningWindow, ReaderPromises, AuthorStylePreferences。输出语义：rhythm-plan-proposal。资料视角：author_design。

来源提示词：P06, P39。验证职责：output.schema, planning.window, planning.locked-outcomes, evidence.not-fabricated, planning.not-canon。

### 近期批次细纲

仅细化宿主指定窗口内的章节，写明参与人物、即时目标、阻力、关键选择、结果与必要衔接。细纲固定因果骨架，给对白和表达保留空间；预期状态保持计划属性。旧工作流要求整批完整时必须交齐，新滚动窗口仅在已启用的工作流版本下使用，不自行缩短任务。

输入：ChapterRoadmap, RhythmPlan, PlanningWindow, ScopedMemoryPacket, AuthorContract。输出语义：batch-outline-proposal。资料视角：author_design。

来源提示词：P06, P40。验证职责：output.schema, planning.window, workflow.stage-gates, planning.chapter-coverage, planning.not-canon。

## 07 单章与场景合同

技能标识：scene-contract。

用于生成当前章写作必须的场景约束、人物入场条件和结果；不产出正文或正式记忆。

把已确认计划变成当前章可写的场景，明确人物此刻想要什么、如何行动、阻力为何回应以及结果改变什么。将作者硬要求、必要因果、知情边界与关键结果固定，普通动作和修辞留给正文。分别标明读者、视角人物及其他角色可知的信息，误信与客观事实不能混用。承接人物可靠的入场状态、名称、资源和时间，不把旧情绪自动延长。选择本章应兑现或推进的承诺；预期离场变化仍是计划。关键缺失使用本轮合同的阻断字段，不增添无谓审批。

### 规划当前章场景

为当前章选择视角、场景顺序、参与者目标、关键动作与回应、必须传达的信息及出口状态。区分 requiredBeats 与 optionalTexture，避免提前写满对白和修辞。章末期待须来自实际选择或发现；新命名在本轮允许范围内完成，正文沿用映射。无法成立的关键因果列明缺口，不更新正史。

输入：ApprovedChapterPlan, ScopedMemoryPacket, CharacterEntryStates, NameMap, VoiceSlice, AuthorContract。输出语义：scene-contract。资料视角：author_design。

来源提示词：P07, P41。验证职责：output.schema, memory.readiness, scene.knowledge-boundaries, scene.required-beats, source.valid-refs, planning.not-canon。

## 08 作品声音与试写

技能标识：voice-calibration。

用于提炼声音档案、在固定场景比较文风或依据作者选择更新档案；没有样本时明确按描述提出建议。

为本书建立可观察、可选择、适用范围清楚的声音。将作者要求、已启用档案、样本与新候选分开，样本只供分析表达，不提供本书事实。围绕叙述距离、节奏、词汇、注意力、人物、对白、信息、情绪、回报与衔接提炼正向做法，并保留例外。没有证据不编造比例，不把长句、直白说明或有意复现一律视为问题。试写固定事实与结果，改变表达取向；只有作者选择支持的特征才能成为更新候选。操作彼此可独立运行，不默认连续调用。

### 提炼声音档案

从真正提供的样本与作者描述提炼十维声音候选，写明可观察做法、适用场景、例外和来源。区分值得继承的特点与病句、无效重复等问题。无样本时据要求提出建议并明确来源，不声称完成样本分析；证据不足的维度保留待验证，不生成试写凑齐结果。

输入：AuthorStylePreferences, StyleSamples, CurrentVoiceProfile, StyleSourceMetadata。输出语义：voice-profile-proposal。资料视角：author_design。

来源提示词：P08, P45。验证职责：output.schema, voice.source-provenance, voice.no-story-facts, evidence.not-fabricated。

### 提炼并试写

在同一次正常请求中给出声音候选和宿主指定数量的短试写。各版本共享人物、知情、关键行动、结果和长度区间，仅改变叙述距离、观察重点、节奏与对白方式。每案突出少量可辨差别，不靠增加新设定或换剧情获胜。差异说明放独立字段，不夹入试写正文。

输入：AuthorStylePreferences, StyleSamples, SceneContract, RequestedVariantCount, SharedFactConstraints。输出语义：voice-calibration-batch。资料视角：author_design。

来源提示词：P08。验证职责：output.schema, voice.variant-count, voice.shared-facts, voice.source-provenance, voice.prose-clean。

### 按选择更新声音

依据作者明确选择、拒绝或说明形成当前档案的最小更新，标明支持每项变化的证据和适用范围。一次偏好不能自动升级为全书禁词或所有场景的规则；与既有要求冲突时列明差异。未选候选保持未启用，宿主负责版本与启用状态，模型不宣布已经替换档案。

输入：CurrentVoiceProfile, AuthorSelections, PreferenceEvidence, VoiceUpdateScope。输出语义：voice-profile-change-proposal。资料视角：author_design。

来源提示词：P08。验证职责：output.schema, object.version-binding, voice.preference-evidence, revision.allowed-scope, output.no-write-claim。

### 已有档案同场景比较

对输入的二至三个候选档案写同一场景试稿，固定事件、视角、人物目标、知情、关键对话事实与收束结果。差别只体现在声音，不能新增身份、能力、物件或真相。无法保持事实时标明不适用。交付供宿主匿名排列的试写和事实保持记录，不替作者选胜者或自动启用档案。

输入：CandidateVoiceProfiles, SceneContract, ScopedMemoryPacket, PilotLengthRange。输出语义：pilot-batch。资料视角：author_design。

来源提示词：P09。验证职责：output.schema, voice.variant-count, voice.shared-facts, voice.prose-clean, voice.no-auto-selection。

## 09 章节正文创作

技能标识：chapter-draft。

用于必要记忆和场景条件已就绪的当前章正文；成功输出仅含小说，不同时输出设定、审稿或记忆报告。

从人物的具体处境和欲望开始，让行动、回应、代价与后果承担推进。观察服从人物经历、职业、关系和压力，选取真正影响行动或理解的细节。对白具有当下目的，允许说明、沉默和回避，但不能让所有人共享同一声口。依据场景功能调节节奏与信息，完成本章要求的变化或兑现，不靠假悬念和重复心理凑字数。严格承接本轮知情、状态、名称与作者要求，样本文风不能带入情节事实。发现关键依赖冲突时仅使用实际实现的异常出口，成功正文不含技术字段或注释。

### 生成当前章正文

以 SceneContract、有效记忆包与 VoiceSlice 写出本章完整正文和章名。让人物按各自所知与所信行动，误信可以影响选择；叙述只揭示本轮允许的信息。旧情绪仅作为最后观测依据，不凭间隔章节推定持续或消失。本次生成内修正无因果转折、错位声口和重复解释，交付正文候选，不声明采纳或记忆就绪。

输入：SceneContract, ScopedMemoryPacket, AuthorContract, VoiceSlice, CharacterEntryStates, NameMap。输出语义：chapter-prose。资料视角：scoped_pov。

来源提示词：P10, P42。验证职责：prose.protocol, memory.readiness, source.snapshot-binding, author.locked-constraints, scene.knowledge-boundaries, prose.no-machine-metadata。

## 10 章节证据审阅

技能标识：chapter-review。

用于对指定正文版本独立检查作者要求、因果、人物与阅读效果；问题必须定位到当前正文。

以指定正文 hash、场景合同、作者要求和有效事实审阅，先找证据，再说明读者损失与最小修复。保留五项检查，不以增加评分维度代替认真判断。硬约束和关键因果冲突可阻断，可定位的阅读问题要求修订，审美偏好作为非阻断意见。重复、句式与用词命中只是线索，必要解释、有效停顿和角色惯用表达应保留。同一原因的表现合并记录，修改建议不能补造身份或提前揭示真相。本轮只审阅，不改写正文、生成记忆或自发追加审核。

### 审核指定正文

按当前 ReviewReport 合同完整提交一次，五项 checks 各一次并提供当前文本依据。问题绑定正文 hash、原文位置、原因和最小修复；严重度与 checks 结果保持一致。无证据的风格偏好不判错，发现修复必须改变剧情时明确影响。版本不符先指出过期，不沿用旧引文或自称已经通过宿主校验。

输入：ChapterProseCandidate, CandidateHash, SceneContract, AuthorContract, ScopedReviewMemory, VoiceProfile, LocalDiagnosticHints。输出语义：chapter-review-report。资料视角：author_review。

来源提示词：P11, P43。验证职责：output.schema, review.candidate-hash, review.five-checks, review.evidence-required, review.severity-consistency, source.valid-refs。

## 11 有界修订与剧情变更

技能标识：revision。

用于已有证据的文字修复、指定问题处理或作者明确授权的剧情改动；不同操作采用文字补丁或有版本变更合同。

核对当前正文或对象版本、授权范围、问题依据和必须保留的内容，优先做最小有效修改。已经成立的语言、人物选择与节奏不顺手重写，未涉及部分保持不变。措辞、重复说明和信息顺序可以局部修；身份、动机、机制、行动结果或知情改变属于剧情变更，不能伪装为润色。范围补丁与剧情变更使用各自合同，由宿主校验并应用。超出授权只报告具体影响与未解决问题，不自行扩大范围。新正文 hash 需要重新绑定审阅与记忆，旧回执不能证明新稿通过。

### 改善局部表达

只修复能说明读者损失的表达问题，如指代不清、解释重复、对白立场错位或节奏妨碍理解。先判断命中表达是否有功能，不用禁词、错字、碎句或无用生活细节制造自然感。保持事实、人物目标和结果；没有明确问题时可交空补丁。必须新增剧情才能解决时列明需求，不夹带改设定。

输入：ChapterProseCandidate, CandidateHash, AllowedTextRanges, VoiceProfile, ReaderImpactFindings。输出语义：prose-patch-proposal。资料视角：author_review。

来源提示词：P12, P46。验证职责：output.schema, patch.base-hash, patch.allowed-ranges, patch.non-overlap, patch.anchor-match, revision.plot-escalation。

### 修复已确认问题

针对输入的问题与允许段落提交范围补丁，提供准确原文、稳定锚点、替换片段和已处理问题。修复因果表达、衔接与局部冲突时保住名称、数量、时序、关系结果和知情，范围外内容不动。无法在授权内解决则保留未解决项。宿主应用后重新计算 hash 并安排必要复审，不沿用旧版通过结论。

输入：ChapterProseCandidate, CandidateHash, ConfirmedFindings, AllowedTextRanges, PreservationConstraints。输出语义：prose-patch-proposal。资料视角：author_review。

来源提示词：P13。验证职责：output.schema, patch.base-hash, patch.allowed-ranges, patch.non-overlap, patch.anchor-match, revision.issue-coverage。

### 提出剧情修订

依据作者明确授权提出影响剧情的有版本变更，分清未来计划调整、事实纠错与追溯改设定。复用对象变更和依赖组合同，列明动机、行动、结果或知情变化及其已知影响，不伪装成保事实文字补丁。宿主先提供依赖范围；未授权关联对象只列影响，不自动重写后文或宣布完整覆盖。

输入：CreativeObjectSnapshot, AuthorRevisionRequest, CoCreationAuthorization, DependencySummary, AffectedCanonReferences。输出语义：creative-change-proposal。资料视角：author_design。

来源提示词：P04, P48, P13。验证职责：output.schema, object.version-binding, revision.allowed-scope, changes.dependency-groups, author.constraint-revision, impact.host-scope。

## 12 章后事实与人物状态

技能标识：memory-delta。

用于对指定版本正文批量提取事实、事件和人物状态增量；与既有记忆提取合并，不逐角色启动模型。

从指定正文版本、有效旧状态与来源提取有证据的稀疏变化，按场景和事件顺序处理。区分客观事件、人物发言、明确内心、持有信念与模型解释，计划不是已发生事实。核对所有实际参与或受影响角色，允许无变化、证据不足、仅提及与身份待解析，不为填表制造心理。回忆状态落在对应故事时段，旧情绪不自动覆盖当前。稳定人格与作者锁定内容不由本轮推断重写。候选正文的增量仍是候选，正文及依赖版本变化须重新核验，只有宿主能确认正式同步。

### 批量提取本章增量

在同一提交中记录世界变化、人物七类状态变化和逐角色覆盖，引用原文短句、码点位置与本轮正文 hash。分别处理现场、回忆、仅提及和未出场但受影响者，记录信念通过什么事件获得或修正。动作不自动证明动机，言论不自动证明真相；无法证明的解释保持候选。遵守 read-set 与完整提交合同，不逐人另发请求。

输入：ChapterProseCandidate, CandidateHash, ReadSetV3, PreviousCharacterStates, EntityRoster, MemoryExtractionScope。输出语义：chapter-memory-delta。资料视角：author_review。

来源提示词：P14, P44。验证职责：output.schema, memory.body-hash, memory.read-set, source.codepoint-evidence, characters.coverage, memory.sparse-delta, belief.world-separation, memory.time-binding。

## 13 记忆与角色状态核验

技能标识：memory-review。

用于既有独立记忆审核位置，核验当前正文对应的事实增量与人物覆盖；不新增固定审核链。

以当前正文、确认设定和有效旧状态核验增量，分别判断 supported、contradicted 与 unclear，并给必要来源。提取结果不能作为自身成立的证据，衍生台账也不能替代原文。检查角色身份、覆盖、事件顺序、时间范围和信息获得过程，区分发言、内心、信念与世界真相。回忆不得覆盖现在，一次情绪不得改写稳定人格，情绪是否持续不能仅由章数间隔决定。来源或版本失效时明确指出，不补造事实、不改写正文、不宣告采纳。完成当前审核即停止。

### 核验本章记忆候选

对绑定同一正文 hash 与 read-set 的 MemoryDeltaV3 逐项核验，检查漏掉或错误合并的人物及覆盖状态。知情证据不得夹带人物尚未得知的旁白真相；确认误信只确认心理状态。无变化与不可观察均可成立，证据不足标 unclear。分别检查状态正常结束、编辑纠错和候选解释，返回本轮结构，不自发请求复核。

输入：ChapterProseCandidate, CandidateHash, ChapterMemoryDelta, ReadSetV3, PreviousCharacterStates, MemoryEvidence。输出语义：memory-review-report。资料视角：author_review。

来源提示词：P15。验证职责：output.schema, review.candidate-hash, memory.read-set, review.evidence-required, characters.coverage, belief.world-separation, memory.time-binding, source.valid-refs。

## 14 有来源的故事记忆问答

技能标识：memory-query。

用于作者查询事实、人物知情、历史状态或完整清单；查询范围与结果完整性由宿主明确提供。

根据宿主确定的项目、分支、编辑版本、故事时间、叙述范围与视角回答。区分当前正史在过去时点的状态和旧编辑版本当时保存的内容，不能混用。人物确信不等于世界真相，作者知道的信息不自动属于人物。精确和全量查询由宿主执行，模型负责解释有效结果及来源。检索未命中不是不存在的证据，有限召回不冒充全部记录。资料不足、投影未就绪或查询未完成时说明实际缺口，不用猜测填满答案。回答不改变设定、人物状态或历史版本。

### 回答记忆查询

先遵守已确定的查询范围，再使用宿主返回的记录与证据回答当前问题。需要全部结果时要求完整分页或明确完整性标记，不把 Top-k 片段写成全量结论。历史知情按获取信息事件过滤，引用原文也不能带入视角未知信息。标明事实、信念和推断的区别，并说明无法确认的部分；只回答，不更新记忆。

输入：AuthorMemoryQuestion, MemoryQueryScopeV3, ScopedQueryResults, QueryCompleteness, SourceEvidence。输出语义：sourced-memory-answer。资料视角：scoped_query。

来源提示词：P16。验证职责：output.schema, query.scope, query.completeness, source.valid-refs, query.perspective-filter, output.no-write-claim。

## 15 重大事件后的角色反思

技能标识：character-reflection。

仅用于宿主选定的重大转折、持续价值冲突或作者指定的人物反思；普通章节不自动逐人运行。

依据指定人物的稳定内核、当前状态和有来源经历，提出可能改变其自我认识、关系判断或目标权衡的解释。只使用人物能够经历或获知的信息，保留犹豫、矛盾与仍未改变的部分。明确区分正文已经写出的内心、作者确认的心理和本轮候选解释，不补造成长所需的旧事。反思不自动修改人格、阵营、感情、信念或长期目标。没有足够依据可以不提出候选。按本轮事件批量处理指定人物，选择、后续描写与正式状态生效仍由作者和宿主决定。

### 生成反思候选

围绕输入的转折、目标受挫或关系变化，为指定角色给出必要的经历理解及可能影响，并引用支持事件。单次情绪不能直接推出永久人格改变，人物可以尚未想明白或暂不改变。所有新增解释保持候选，无充分依据时返回无必要候选及简短原因。不写后台模拟日志，不额外为每个角色启动请求。

输入：ReflectionTrigger, ScopedCharacterExperiences, CharacterCores, CurrentCharacterStates, ReflectionRoster。输出语义：character-interpretation-candidates。资料视角：scoped_pov。

来源提示词：P17。验证职责：output.schema, reflection.trigger-scope, source.valid-refs, query.perspective-filter, characters.core-state-separation, reflection.candidate-only。

## 16 跨章连续性与承诺审阅

技能标识：canon-audit。

用于指定范围的连续性检查、修订影响解释、承诺清单核验和卷末或全书收束审阅。

以有效正文、确认设定、人物状态和承诺来源审阅指定范围。事实、角色认知、未来计划与作者有意留白分别处理，问题必须有可定位证据和具体影响。依赖发现、查询完整性、失效与重放由宿主负责，模型只能解释收到的范围，不能凭叙述宣告覆盖全书。区分需要修订的矛盾、可选改进与仍待后文判断之处，给出最小处理范围，不用新设定替旧问题补洞。已采纳或已发布内容不自动重写，审阅结果保持问题记录或候选建议。

### 检查跨章连续性

核对指定章段中的时间、位置、资源、身份、人物知情和关系变化，依据有效来源区分真正冲突与合理隐瞒、误信或叙述省略。问题注明所涉版本、证据与受影响情节。宿主提供的范围外内容不能声称已检查；没有可靠来源时保留待核对，不为完整报告制造矛盾。

输入：ContinuityAuditScope, AcceptedProseReferences, ScopedCanonStates, SourceEvidence, QueryCompleteness。输出语义：continuity-audit-report。资料视角：author_review。

来源提示词：P47, P15。验证职责：output.schema, audit.scope, query.completeness, source.valid-refs, review.evidence-required, belief.world-separation。

### 解释变更影响

基于宿主依赖引擎给出的记录依赖、查询依赖和受影响对象解释本次变更后果。区分确定失效、需要语义复核和没有证据的猜测，给必要修订候选及依赖组。宿主没有提供完整影响集时不能宣称覆盖全部。不要自行发现并执行数据库失效、重放或全书改写，也不自动改未获授权的对象。

输入：ProposedChangeSet, HostDependencyImpactSet, DependencyCompleteness, AffectedObjectSnapshots, AuthorAuthorization。输出语义：change-impact-analysis。资料视角：author_review。

来源提示词：P48, P04。验证职责：output.schema, impact.host-scope, impact.completeness-label, source.valid-refs, revision.allowed-scope, output.no-write-claim。

### 核验阅读承诺

逐项核对宿主查询到的指定承诺，区分已经兑现、正在推进、明确留后、作者有意留白和可能遗漏。兑现需要正文位置及实际结果，计划中的解决不能算已完成。全量清单必须有宿主完整性依据，未命中不等于从未埋设。指出到期风险和最小补全范围，不自动新增剧情或改写后文。

输入：PromiseLedger, PromiseAuditScope, AcceptedProseReferences, QueryCompleteness, AuthorIntentRecords。输出语义：promise-audit-report。资料视角：author_review。

来源提示词：P20, P47。验证职责：output.schema, audit.scope, query.completeness, source.valid-refs, promises.evidence-status, planning.not-canon。

### 卷末与完结审阅

核对本卷或全书的核心矛盾、人物选择、关键关系与阅读承诺是否获得相称结果，结果是否来自前文行动，代价和余波是否处理。卷末可留后续问题，但主要目标须有实质变化；开放结局不能掩盖未成立的因果。对缺口给最小补全范围与前文依据，不靠突加设定或摘要跳结局补齐。

输入：EndingAuditScope, PromiseLedger, AcceptedProseReferences, CharacterAndRelationshipStates, AuthorEndingContract。输出语义：ending-audit-report。资料视角：author_review。

来源提示词：P20。验证职责：output.schema, audit.scope, source.valid-refs, review.evidence-required, promises.evidence-status, author.locked-constraints。

## 17 平台与题材证据研究

技能标识：market-evidence。

用于明确的题材、平台规则或公开题面研究；正常创作不会因为该技能存在而自动联网。

只研究当前策划或包装确实需要的问题，并使用宿主授予的范围和来源能力。区分平台规则、官方创作经验、公开作品题面和真实读者反馈，保留来源、发布日期、获取时间及适用范围。编辑推论单独呈现，搜索排序不冒充榜单，成功个案不代表普遍规律。样本用于理解承诺与表达，不复制专名、标志性台词、正文或独创情节。无联网能力时仅使用已注明日期的离线证据；冲突来源按时间与适用范围核对，不能凭主观选择宣告最新政策。

### 收集并分析相关证据

围绕输入问题收集获授权的公开一手资料，提炼少量与本书有关的观察、排除项和仍未知内容。每条判断连接具体来源，区分平台原意与编辑推论。政策冲突无法裁决时保留冲突；没有可用搜索能力不假装联网。输出证据摘要，不生成无依据的流量保证，也不将研究转成发布、登录或联系他人操作。

输入：ResearchQuestion, AllowedSourceScope, ExistingMarketEvidence, GenreAndProjectContext, ResearchFreshnessPolicy。输出语义：market-evidence-report。资料视角：author_design。

来源提示词：P18, P49。验证职责：output.schema, research.source-scope, research.provenance-time, research.primary-evidence, evidence.not-fabricated, research.inference-label。

## 18 名称与读者题面

技能标识：packaging。

用于实体命名、书名、简介及指定包装产物的审阅；每次按 operation 和宿主 targetKind 选择唯一实际合同。

用准确、可辨识且符合本书气质的名称与题面传达真实阅读承诺。来源限于作者要求、已确认故事内容和标注清楚的参考资料，不为吸引点击发明能力、关系或剧情。实体新命名和已接受改名分开，保护旧名、别名、历史身份与人物知情，已接受改名通过有版本变更处理。字数、候选数量、推荐规则和审核字段服从本轮合同，不把某次实验约束写成平台通则。标题、实体名与简介有不同输出结构，宿主必须解析唯一 schema；本技能只交候选或审核，不发布。

### 实体命名与改名候选

依据实体类型、时代文化、命名者、当前名称表和禁区给出合适候选，减少本书内音形混淆。名称不能顺带补造组织、能力或制度，首次称谓须符合人物所知。已接受改名时列实体、旧新名、有效时段、保留别名与影响候选，不全书替换。未进行相应检索不能宣称全网唯一。

输入：EntityNamingScope, NameMap, WorldNamingRules, CharacterKnowledgeScope, AuthorNamingRequest。输出语义：entity-name-proposal。资料视角：author_design。

来源提示词：P50。验证职责：output.schema, naming.accepted-protection, naming.alias-scope, naming.knowledge-boundaries, revision.allowed-scope, evidence.not-fabricated。

### 书名候选

依据正式故事承诺、作者偏好和允许的题面资料生成本轮指定数量的书名候选，推荐理由对应真实卖点。候选不能暗示本书没有的身份、能力或关系；事实支持引用当前合同允许的故事陈述。数量、部分重做、长度及推荐范围遵守实际版本，不能把产品默认数量或实验字数限制当作普遍规则。

输入：ConfirmedStoryContract, TitlePreferences, MarketEvidence, TitleGenerationScope, TitleOutputContract。输出语义：title-candidates。资料视角：author_design。

来源提示词：P30。验证职责：output.schema, title.candidate-count, title.contract-length, title.story-claim-support, title.regeneration-scope, title.recommendation-range。

### 简介与题面文案

为指定载体写清人物处境、特有矛盾和读者能获得的阅读回报，在允许揭示范围内形成具体吸引力。语气与本书声音一致，避免空泛评价、爆款自夸和虚假承诺；不能为题面补造正文没有的剧情。按宿主给定长度和版本提交候选，保留作者禁区，不自动发布或修改正式资料。

输入：ConfirmedStoryContract, PackagingBrief, VoiceProfile, RevealScope, AuthorContract。输出语义：packaging-copy-proposal。资料视角：author_design。

来源提示词：P51。验证职责：output.schema, packaging.claim-support, packaging.reveal-scope, author.locked-constraints, packaging.length, output.no-write-claim。

### 核验指定题面

宿主先依据 targetKind 将实体名、书名或简介解析为唯一审核 schema，再审核指定版本候选。核对事实支持、作者要求、名称保护、数量或长度规则以及揭示边界；风格喜好与事实拒绝理由分开。只提交该对象合同需要的问题或保留结果，不混合其他审核字段，不改写候选或追加新一轮审核。

输入：PackagingTargetKind, ResolvedReviewContract, PackagingCandidate, CandidateVersion, ConfirmedStoryContract, AuthorContract。输出语义：target-resolved-packaging-review。资料视角：author_review。

来源提示词：P31, P50, P51。验证职责：output.schema, packaging.single-resolved-contract, review.candidate-version, review.evidence-required, packaging.claim-support, packaging.reveal-scope。

## 19 读者反馈与创作实验

技能标识：reader-feedback。

用于真实评论或阅读指标的限定分析；没有真实数据时只提出待验证假设，不伪造市场效果。

使用有来源、时间、正文版本、统计口径与样本量的真实材料；模拟读者意见必须独立标识。把入口、开篇兑现、局部理解、人物关系、长线重复、更新和曝光变化分开分析。单条评论不代表总体，指标变化可能受人群和曝光影响，保留替代解释。优先定位可操作的问题与少量单变量实验，不追逐少数意见推翻已确认方向。统计计算由宿主完成，模型解释证据和取舍。反馈可以支持作者偏好或编辑经验候选，不能自动写入正史、全局文风或平台发布操作。

### 诊断并提出下一轮实验

给出不超过三个优先诊断，每项包含证据、可能解释、替代解释、涉及章段、建议改变的变量与观察方式。比较实验需对应版本和相近窗口，允许平局、噪声及未定结果。缺乏样本时明确提出假设，不补造留存、收入或人数。返回分析与可选改进，不执行发布、联系读者或自动改写作品。

输入：ReaderFeedbackEvidence, HostComputedMetrics, ChapterVersionBindings, ExperimentHistory, AuthorPriorities。输出语义：reader-feedback-analysis。资料视角：author_review。

来源提示词：P19, P52, P53。验证职责：output.schema, feedback.provenance, feedback.sample-denominators, feedback.version-comparability, feedback.simulation-label, feedback.max-three-priorities, output.no-write-claim。
