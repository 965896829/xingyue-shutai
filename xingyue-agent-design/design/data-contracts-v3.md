# V3 数据合同与持久化边界

本目录的 V3 TypeScript 和 SQL 是可审阅的合同草案。SQLite 示例可以在新临时数据库中执行，但尚未接入客户端；实际迁移应复用现有 Fact、文档版本、采纳事务、journal 与 outbox。

## 权威数据

MemoryClaimProjectionV3 的 authorityBinding 指向现有事实 ID 和 hash，并按 lane 区分依据：accepted 绑定原有采纳变更，candidate 绑定原有候选，derived 绑定派生产物。候选和派生索引不能为了满足字段而伪造采纳变更。正文和已确认设定的不可变 SourceVersion 提供原始证据。legacyFactDocumentVersionId 只服务旧台账迁移，可为空；新人物状态不依赖重写完整台账。

角色卡、台账、摘要、搜索索引与图形都是投影。派生文档不能成为新的独立原始证据。观察和反思保留原始事件引用，不能因为被多个摘要引用而增加其证据权重。

## 共享时间与查询

memory-contracts-v3.ts 提供共用 NarrativePointV3、MemoryQueryScopeV3 和覆盖状态。character-mind-v3.ts 引用这些类型，避免使用另一套章号、版本和状态词汇。

current_canon_as_of_chapter 表示当前已确认编辑版本下回看某个叙述位置；historical_edition_as_of_revision 表示固定历史编辑版本。分支继承以固定父版本和 overlay manifest 为准，不能用 worldId 或故事 timelineId 代替编辑分支。

叙述位置使用稳定章节和场景 ID、版本内章节/场景顺序、事件序号及码点偏移。故事时间使用事件锚点与偏序，允许未知。回忆的旧心理落在旧故事时段，回忆触发的当前情绪另记当前事件。

## 字段适配

- 全部新证据采用 Unicode 码点半开区间 [start,end)。旧 V2 UTF-16 位置仅在已知单位时通过转换函数转换，并重新核对引文。当前 0.4.82 证据本来就是码点，不应重复转换。
- TS 的结构化 payload 是加载后的对象；SQL 的 payload_ref 指向不可变序列化对象。编解码器校验 schema ID 和内容 hash。
- building、stale、failed 的投影 outputHash 可以为空；ready 必须有输出 hash。命题 bindingState 对应 active/stale，relatedClaimIds 对应 related_claim_ids_json；它们只是投影可用性和关联信息。
- SQL 使用 branch 关联得到部分 project 字段；跨表引用仍须验证同项目和合法继承范围。
- SQL 的 replacement_claim_id 对应正常状态结束的 successorClaimId 或纠错后的 replacementClaimId，由生命周期 kind 区分。
- TS 允许以通用证据类型表达候选覆盖；宿主校验来源后分配 evidence ID，持久化保存引用。
- 命题的 evidenceRefIds 在 SQL 中保存为数组，并通过触发器同步到 v3_memory_claim_evidence 反向索引；原文修订可由 source version → evidence → claim 定位，不依赖扫描全部 JSON。该关联表只是可重建索引，不授予新的事实权威。
- MemoryClaimProjectionV3 与 MindBeliefV3 共用 BeliefStanceV3；knows 表示角色确信已知，不能因此把人物命题提升为客观事实。人物层 holderId 与索引层 holderActorId 由 adapter 映射到同一稳定角色 ID。
- 匿名但实际出场的人物使用稳定临时 entity ID；姓名无法归并时保持 unresolved_identity，不按 embedding 相似度合并。
- 无依据的 motivation、strategy 和 meaningToCharacter 可以缺省。缺省表示未知，不允许为满足非空字段而补造。

## 提交不变量

正式发布同时验证正文 hash、来源版本、基准状态、角色名单、具体读集、查询依赖和空结果依赖。正文、已验证状态、分区 epoch 变化与 outbox 登记进入现有同一提交边界。相同幂等键返回同载荷的既有结果；载荷不同则拒绝。

每章 coverage 对实际人物名单完整覆盖。changed 对应实际增量；无变化和依据不足不写虚构值。人物心智中的原命题不自动获得客观真值；正常状态结束保留旧时间段，纠错撤回只在对应编辑版本生效。

索引水位表示指定范围内所有必需工作已完成的连续前沿，不能只取收到的最大事件序号。存在失败或待处理缺口时，当前范围不能标 ready。非必需向量和摘要可以异步，写作必须读取同版本核心状态。

模型任务继续使用现有网关请求与恢复记录。outbox 的租约到期不自动重发结果未知的模型请求；outcome_unknown 与普通本地重试分别处理。

## 查询与失效不变量

关系、时间与语义检索先执行范围限制，结果再次校验。来源引文匹配可以缓存，来源在当前版本的有效性不能永久缓存。角色原文片段不得携带未获知秘密，秘密身份别名也受揭示边界限制。

absence 只记录范围完整、索引就绪的查询结果；没有搜到不能成为故事否定事实。依赖必须包含查询条件和分区 epoch，新增事实也能使旧推论失效。依赖不完整的旧作品继续采用保守核对范围。

SQL CHECK 和外键不能完整验证 JSON 内部结构、故事偏序无环、分支继承合法、引文真实、覆盖集合、scope 权限和模型语义。正式 adapter 必须实现这些验证；SQL 示例通过不等于全部工程已实现。

## 复现合同检查

在设计包根目录运行以下命令。repository 指向已安装 TypeScript 开发依赖的项目目录，也可以用 --typescript 指定 TypeScript 包路径。检查只创建新的临时数据库，不打开作品数据库。

```sh
python evaluation/contract-checks-v3.py --repository /path/to/xingyue-shutai --work-dir /path/to/report_build/contract-checks-v3
```

结果写入 audit/contract-verification-v3.json，包含数据库约束、Unicode 位置转换、全部合同的 strict TypeScript 检查、注释扫描及文件 hash。它不执行真实模型调用、生产迁移或小说质量评测。
