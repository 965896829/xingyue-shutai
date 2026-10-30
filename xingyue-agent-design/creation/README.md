# 0.4.82 创作与书名阶段提示词候选

基线：`965896829/xingyue-shutai`，commit `b505f6f459db74871f39f63acf6106b827c8a353`，0.4.82。此目录仅交付五份资源文本与接入说明，没有修改项目、工具 schema、任务记录或资源锁。

## 适用边界

这是**现有输出合同兼容的专项提示词**，不是独立完整系统消息。客户端仍负责拼接总控、当前阶段合同、模板、语言要求、表达规则，并通过工具定义提供 JSON Schema。不得把文本中的语义要求当作新增 JSON 字段，也不得同时把旧版专项全文再次拼入。

| 本目录资源 | 未来替换位置（相对项目根） | 实际工具 / 路由 |
|---|---|---|
| `direction-planning/planner.system.md` | `resources/skill/direction-planning/planner.system.md` | `submit_planning_report`；仅 `directionFormatVersion === 1` 的 planning |
| `tags/prompts/contract.system.md` | `resources/skill/tags/prompts/contract.system.md` | `submit_creation_contract`；contract |
| `tags/prompts/reviewer.system.md` | `resources/skill/tags/prompts/reviewer.system.md` | `submit_planning_review`；当前正常路径仅 reviewing_contract |
| `title-market-editing/writer.system.md` | `resources/skill/title-market-editing/writer.system.md` | `submit_title_candidates`；仅 editorialVersion 2 |
| `title-market-editing/reviewer.system.md` | `resources/skill/title-market-editing/reviewer.system.md` | `submit_title_review`；仅 editorialVersion 2 |

`src/core/creation-prompts.ts` 的 `planningSystemPrompt` / `titleSystemPrompt` 继续承担版本分流。`src/core/tag-planning.ts` / `title-naming.ts` 继续选择输出 schema、执行工具、检查、限次修复与保存。这五份文本不替代这些代码。

## 明确保留的新旧行为

### 三个方向

- 新格式只有 `positioning / directions / assumptions / recommendedDirectionId / recommendationReasons`。各方向沿用已有核心字段；不主动输出 `diagnosis / marketClaims / unresolvedQuestions / tagCoverage`。
- 宿主可兼容偶发旧辅助字段并补存储空数组，这不是要求模型继续生成旧辅助字段。
- 没有 `directionFormatVersion` 的旧任务继续读 `resources/skill/tags/prompts/planner.system.md` 与旧 schema；本包不替换该文件，也不回填任务的版本字段。
- 正常三方向成功后直接等待选择。旧 reviewing_report 检查点由宿主本地校验后恢复，不因 reviewer 提示词保留历史分支而新增模型审核。
- `regenerationScope` 是宿主已计算的改动范围；局部重做保留既有编号、冻结正文和相关新增设定。新设定不得借空 `directionIds` 扩散到冻结方向。
- 本包提示词不能修复宿主当前单方向重做的冻结假设校验缺口与改动方向编号校验缺口；这两处仍须由工程方案中的验证器改造处理。

### 完整作品方案与审核

- 继续返回 `directionId / constraints / tagCoverage / openQuestions / premiseDocument`；`plan` 只按宿主当前合同要求。`workflowVersion === 2` 必须有完整 plan；旧任务保持其原来的可选行为。
- `plan.statements` 沿用全部十种 kind、既有 `sourceRefs / optionIds / payoffStage`；`tagRoles` 沿用 `optionId / roles / implementation / claimIds`。本包没有新增 readerContract、memory、score、assumptions 等字段。
- sourceRefs 合法集合仍是 `author-input`、所选方向 ID、当前 constraints ID、已处理假设 ID；引用存在不等于语义支持，审核仍需检查。
- 旧书接入和修订的 `premiseDocument` 必须与 `currentPremise` 完全相同，不为了新提示词改写已接受设定。
- 审核只有 `issues[{code,severity,jsonPointer,explanation,suggestedFix}]`。不新增评分、通过标记、修改稿或质量保证。缺失项定位到已存在父对象，不能构造不存在的 JSON Pointer。
- `repairScope` 仍由宿主计算，有限修复和再审次数继续由代码控制；提示词不授权扩大修改范围。

### 书名

- 生成保留 `planHash / candidates / recommendedIds`；每个候选保留 `id / title / angle / readerPromise / supportingClaimIds / payoffStage / riskNotes`。
- **生成的 recommendedIds 是一至三个；editorialVersion 2 审核的 recommendedIds 是零至三个。** 不把两者合并成一个模板。
- 候选数量优先由宿主计算：手填一个、局部重做沿用原批数量、其他使用 candidateCount；缺失时保留旧任务一至十二个合同，不能统一强制六个。
- `supportingClaimIds` 仅引用 `confirmedPlan.plan.statements` 的 ID，不能使用 constraints ID。`planHash` 必须原样返回。
- editorialVersion 2 审核提交 `decisions + recommendedIds`；未设置或为 1 的旧命名任务仍使用原资源，其审核 schema 不包含 recommendedIds。本包不覆盖 `title-editing/` 或 `tags/prompts/title-*.system.md`。
- 风格不合只影响 V2 推荐与 reason；没有事实冲突不得为风格自动判 revise/reject。手填与冻结名称不改写，局部修复不重新生成整批。
- `rule.local` 为本地长度/保存限制；不能据此放弃番茄题材定位。十五字符只来自 `fanqie_experiment` 当前规则，不当成所有作品书名限制。

## 资源锁与升级迁移

不能只复制 Markdown 然后启动：当前资源加载器会按原始文件字节校验 SHA-256。换行、编码、BOM 的变化也会改变 hash。发布时应将提示词文件与对应锁条目作为同一提交更新，保留其他条目。

| 资源 | 必须更新的锁键 | 影响范围 |
|---|---|---|
| 新三方向 planner | `resources/skill/direction-planning/resources.lock.json` 的 `planner.system.md` | 改变新格式方向规则 hash；不改变旧方向任务的资源路径 |
| contract / reviewer | `resources/skill/tags/resources.lock.json` 的 `prompts/contract.system.md` 与 `prompts/reviewer.system.md` | **共享资源**：改变 creationPromptResources、tagBundle.version，也会参与 planningRulesHash 和 namingRulesHash；不是局部文案热更新 |
| V2 书名 writer / reviewer | `resources/skill/title-market-editing/resources.lock.json` 的对应文件键 | 改变 V2 命名 editorial hash；保留旧版命名、方向资源隔离 |

迁移要求：

1. 在下个发布版本明确提示词变更与锁更新；保留已有旧格式 schema 和资源路由。不要关闭 hash 校验，不把旧任务指纹直接改成新值来伪装已验收。
2. 已接受作品资料、旧候选和审核记录保持原记录；已在进行中的任务按现有交接/规则重载流程处理。`Service` 的 planning 交接会保留候选、清空旧 promptHashes，并在规则变化时清除方案批准与旧审核绑定；naming 交接会保留 batch、重做相应审核。不能承诺“替换后所有既有批准仍自动有效”。
3. 尤其 contract/reviewer 在 tags 的共享锁内。本次兼容资源保持当前路径；若产品要求它们更新完全不影响旧命名和知识指纹，需要后续代码增加独立资源版本与明确迁移，再接入，不能仅在 README 中声称隔离已实现。
4. 复用现有 `tests/creation-prompts.test.ts`、`tests/concise-directions.test.ts`、`tests/planning-completion.test.ts`、`tests/tags.test.ts` 做针对性回归：新旧 wire schema、局部冻结、手填名、动态候选数、旧书 currentPremise、审核 JSON Pointer、资源 hash 与交接。小说效果则用同一输入的作者盲评比较，本包没有冒称已做真实模型效果实验。

## 卷名是否增加第六份

不增加独立卷名 agent。0.4.82 已把整组卷名纳入 S05 分卷大纲同一次创作，使用 `volumeNamingReference` 和 `resources/skill/runtime/references/volume-naming.md`，另有源参考 `resources/skill/references/volume-naming.md`。

可在后续 S05 精简时保留这段核心要求：

> 从每卷不可撤回的选择、关系变化或独特场面提取卷名，整组体现同一本书的气质与阶段递进，不提前揭露后卷真相。复用宿主已核实的目录资料，只借表达方法；无可用资料时不编造实时参考，也不追加搜索。容量表卷名与对应卷标题相同，沿用现有分卷模板，不增加命名解释或独立审核。仅改卷名时只改两处名称，已确认剧情、容量和章节范围保持原样。

这段属于 S05 现有合同内的创作要求；不能接到书名候选工具，也不能用书名市场参考冒充真实分卷目录。
