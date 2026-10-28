**Pi 1.4.0 复用审计：模型连接、上下文、缓存与恢复**

审计日期：2026-10-28。对象为客户端 0.4.79 源码、已安装的 `@earendil-works/pi-agent-core` / `pi-ai` 1.4.0，以及官方仓库 `v1.4.0` 对应源码。结论只覆盖本次检查范围。本次只新增审计文档和离线实验文件；没有改生产代码、安装客户端、改作品或模型配置，也没有调用真实模型。

**结论：应进一步复用 Pi 的模型适配层，并统一客户端的请求准备与检查。小说上下文和持久化恢复仍需由客户端负责，但可以减少散落在各阶段的重复实现。**

当前 Pi 执行循环已实际进入生产调用链。`src/core/runtime/task-loop.ts:115` 调用 `runAgentLoop`，传入自定义 StreamFn；StreamFn 调用宿主 `turn.request`，最终进入 `model-gateway.ts` 和 `provider.ts`。Pi 用于调度的消息投影没有额外发送给模型，因此“Pi 与自研代码同时存在”不等于每轮请求了两次模型。S01—S11 的阶段推进、何时结束以及何时修订，目前仍由宿主业务回调判断。

之前保留宿主网关有明确原因：它记录原生响应、候选、费用未知状态、累计轮数、来源版本和提交事务。官方 Pi 的通用消息结构不能原样替代这些记录。不过，通用协议转换和流处理仍集中在 873 行的 `provider.ts`，确有继续迁移的空间。不能将这 873 行全部视为可删除代码。

| 层 | Pi 已有能力 | 本项目的处理建议 | 对请求与质量的影响 |
|---|---|---|---|
| Agent 循环 | `runAgentLoop`、prepareRequest、finishTurn、工具顺序与事件 | 继续复用；阶段完成判定统一走宿主的确定性结果 | 完整候选提交后直接结束，不增加纯收尾请求 |
| 标准模型连接 | OpenAI Responses / Chat Completions、Anthropic、Gemini 适配器；流事件、错误和 usage 解析 | 优先迁移标准 HTTP 路径；通过公开 onPayload / onProviderStreamEvent 等接口添加薄兼容层 | 减少协议代码维护；迁移本身不保证减少模型推理时间 |
| Sub2 的 Responses WebSocket | Pi 的 Codex 专用适配器有连接池、会话续接和降级 | 借鉴连接池生命周期；不能直接把 Sub2 API key 接进 Codex OAuth 适配器 | 可减少客户端到中转的重复建连；不能据此断言修复中转到 ChatGPT 的握手或排队 |
| 请求准备、容量和预算 | Pi 可在请求出口观察/调整最终 payload | 客户端保留一个统一入口；对最终实际发送内容只做一次权威容量与预算决定 | 消除准备前后口径不同导致的误挡；不移除真实容量和费用限制 |
| 小说上下文 | transformContext / convertToLlm 等扩展点 | 接入现有事实、人物视角、时间线和来源编译器；稳定输入不重复重建 | 保留 Skill 约束，避免把作者秘密、计划或旧版本当作人物已知事实 |
| 会话摘要压缩 | `pi-coding-agent` 的 compaction，另一个包 | 当前创作主链继续用可精确还原的阶段交接；不默认启用模型摘要压缩 | Pi 摘要本身需要模型调用，拆分回合时可能调用两次；不能作为零请求压缩替代品 |
| 服务端 prompt cache | sessionId、cacheRetention、协议适配、工具/系统消息兼容选项 | 复用协议能力，保留来源排序、稳定规则块、精确版本绑定；按接口能力启用 | 稳定会话标识不能单独保证命中，不能靠保留无用历史追求高比例 |
| 审稿结果复用 | 通用 Pi 没有小说证据绑定的审稿缓存 | 保留 validated-review-cache，统一依赖和失效规则 | 相同依据复用原判断；负面判断也保留，不能将命中当成自动通过 |
| 中断和崩溃恢复 | Pi 会话树、消息回放、取消；部分适配器含重试/降级 | 保留请求账本、未知结果状态、部分输出、工具去重与提交事务；只保留一个重发决策入口 | 不重复计费、不重复落盘、不靠提高轮数隐藏失败 |

**已确认的具体问题与边界**

1. 连接无法跨请求复用。`provider.ts:528` 每次建立新 WebSocket，`provider.ts:611` 关闭它；`provider.ts:627` 每次创建 Undici Agent / ProxyAgent，结束时 `provider.ts:871` 销毁。只读检查模型配置发现 gpt-6.1-sol 使用 Responses WebSocket。这里存在可消除的连接建立开销，但本次没有测量其占整次生成耗时的比例。对于本机 Sub2，这首先影响客户端到 Sub2 的一跳；上游连接池属于 Sub2 的职责。

2. 容量和预算存在多处预检查。通用阶段 `runner.ts:502`、正文调用 `runner.ts:999`、审查调用 `runner.ts:1301` 以及 `telemetry.ts:80` 均有检查；`model-gateway.ts:139–144` 随后才执行缓存会话交接及最终计量。`fitContext` 还负责素材选择。多处检查不会各自调用模型，但部分提前检查的请求形态和最终发送内容不同，也无法利用后面的已测量前缀。存在“最终交接本可装下，却被前置保守估算拦住”的路径；本次没有在用户当前作品中复现一次实际误挡，不能把全部历史阻断归因于它。

3. 当前 gpt-6.1-sol / gpt-6-astra 的自动计数落到 UTF-8 字节上界。模型配置没有显式 tokenizer；`context-budget.ts:13–27` 的自动识别未覆盖这些名称。离线中文样本 1700 字符计为 5100 字节，o200k 对照估计 1600，Pi 压缩的 chars/4 启发式仅 425。o200k 对照不是这些模型的已验证真实 tokenizer；不能直接改名匹配就当作准确。建议用经确认的模型计数方式、相同输入前缀的实际 usage 与保守增量统一估算，保留安全余量及依据标识。Pi 的 chars/4 也不适合直接作为中文请求的硬容量门槛。

4. usage 字段口径不同。离线响应声明输入 1000、缓存读取 950。Pi 返回 `usage.input=50, cacheRead=950`，客户端返回 `input=1000, cachedInput=950`。接入时总输入应按接口口径明确转换，不能直接赋值，更不能拿 950/50 计算缓存率。缺少 usage 时，Pi 本例初始字段为 0，客户端为 null；必须保留“服务端未报告”，不能变成零费用或零消耗。当前客户端对 Anthropic/Gemini 也未像 Pi 那样完整提取缓存字段；迁移是补齐多协议统计的机会。

5. Pi 规范化结果不能替代完整原生证据。模拟的 Responses 仅在 `response.completed.response.output` 中给出正文：客户端 normalize 读出正文，Pi 1.4.0 此适配器结果文本为空。正常包含 output_item.done 的响应则可读出。原生网页搜索、引用、服务端缓存诊断在本例中也没有完整体现在 Pi 的通用 AssistantMessage 中，原始事件回调可以取得。工具调用 ID 在 Pi 中为 `call_fixture|fc_fixture`，客户端保存的是原始 `call_fixture`。迁移必须保留原生输出和映射，处理完成事件补全、引用和调用 ID，避免制造新的“空正文”“缺工具回执”及无效修复请求。这是离线协议兼容验证，没有证明当前 Sub2 正在产生该种事件序列。

6. 必须按源码区分重试与降级。所检查的 Pi 1.4.0 Responses provider retry 默认是 0；离线 HTTP 502 默认只尝试 1 次，显式 `maxRetries:1` 则尝试 2 次。不能声称当前 Pi 默认就在重复发送。Codex 专用 WebSocket 适配器另有回退 SSE、续接失败处理，不能仅凭 maxRetries=0 就假定所有路径只有一次发送。它还从 JWT 读取 ChatGPT account ID，不能直接接受普通 Sub2 分发 key。迁移必须逐个拦截实际发送，保留现有“已有部分输出或上游结果未知时禁止静默重发”的规则。

7. 审查仍会消耗请求，但并非都重复。当前正文审稿、记忆提取和必要的证据核对职责不同。`auditMemory` 已复用未变判断，并在容量允许时合并记忆和后续计划核对；`reviewWithRepair` 已保存原回执并只请求修正指定问题。仍可统一这些调用的准备、格式解析与来源绑定。按条目收窄审稿缓存的失效范围，必须证明完整证据依赖未改变；仅比较某一条文字容易漏掉新出现的矛盾。Pi 通用会话本身不会判断这些文学或事实问题。

**压缩与缓存应分开设计**

本项目实际上有三种不同机制：服务端 prompt/KV 缓存、客户端精确来源交接、客户端有效审稿回执复用。Pi 的 sessionId/cacheRetention 主要作用于第一种，无法取代另外两种。

现有 `cache-session.ts` / `context-checkpoint.ts` 的优势是交接可以从已保存原文与事实重建，无需模型摘要。S10 审稿共享的是生成前资料，不继承写作推理或自我评价，这一点应保留。实现可拆成协议无关的稳定资料层、当前任务层与增量历史层，通过 Pi 钩子装配；动态 run ID、时间和阶段状态留在稳定前缀之后。只有输入依据改变才重新编译，避免每一轮制造新的前缀。

Pi 的 `pi-coding-agent` compaction 属于另一个包，除了写摘要请求外，还显式使用 cacheRetention=none；不能把它当成提高每次缓存率的捷径。它的 SessionManager 保存 JSONL 会话树，而本项目要恢复的是“请求是否已发、费用是否已知、文件是否已提交、事实与证据是否仍匹配”。再增加一个并列权威会话库会增加一致性负担。

缓存率应记录实际报告的缓存读取 token / 实际总输入 token，同时显示统计覆盖率；未报告不能记零或当作命中。首个冷请求、新增正文、阶段规则变化及中转路由都会影响命中，95% 不能由客户端或 Pi 单方保证。更少的历史有时会降低命中百分比，却减少总输入和耗时；应同时比较总请求数、总输入、未命中输入、输出/推理 token、首个有效输出及总时长。

**建议的落地顺序**

1. 先统一一次请求的准备结果和生命周期。对最终实际 payload 执行一次硬容量/预算检查和持久化，然后发送；素材筛选可以提前做，但不再用不同请求版本作互相矛盾的硬拦截。使用 Pi 的 onPayload / fetch 出口观察实际发送内容，适配代码不能在持久化以后偷偷改变 payload。调用计数对应实际发送，格式修正、重试、审稿和联网有各自原因标签。

2. 在现有 ModelGateway 下接入 Pi 标准 HTTP 适配器，先用离线请求/响应对照覆盖四协议。保留一层项目兼容映射：原生块、未知 usage、精确工具 ID、网页引用、结束标记、进展计时与取消。基础协议通过后删除被替代分支；不要长期保留两条都可发送的通道，也不要遇错自动换通道再请求。主力 Sub2 路径通过相同对照后再迁移，不能只迁移用户不用的协议便宣称完成。

3. 单独实现有边界的连接复用：按端点、代理、配置/凭据版本隔离，任务串行占用，断流或取消后淘汰该连接，健康空闲连接复用。参考 Pi 的池和释放机制。先保留完整原生会话发送；previous_response_id 增量续接需要中转能力与恢复语义验证，不能先开启回退重发。保持 Sub2 现有模型入口，不改用户鉴权方式。

4. 把小说 ContextCompiler 放入 Pi 请求准备的扩展点，统一模型容量来源、来源指纹、稳定前缀和阶段交接；依赖 Pi 提供的协议缓存控制，而不是维护越来越长的模型名称正则。保留现有作者规则、人物知识边界、原文/计划区分、S10 审稿独立输入和增量台账。

5. 合并回执缓存与确定性格式处理的入口；只对确实改变的输入重新核对。未知引用、缺失内容、负面审稿结论、真实事实冲突、未知计费和来源版本变化仍按其真实性质处理。对用户显示“生成内容/修改内容/连接中断”等可理解状态，不让用户寻找内部审查按钮。

重构后可以形成一条明确的链路：Skill 定义任务与产物 → 小说上下文编译 → Pi 执行循环 → 唯一请求网关 → Pi 模型适配器（加 Sub2 兼容层）→ 现有工具与持久化提交。阶段、产物和质量要求继续由 Skill 与小说业务约束决定。

**验收边界**

离线先验证：四协议原生信息与调用 ID、缓存分母和未知 usage、只有结束事件的响应、截断和拒绝输出、网络取消和持久化失败、未知请求不重发、重启不重放已提交工具、S01—S11 文件/字段/顺序不变、独立审稿和记忆证据有效、旧项目和 Legacy 检查点可恢复。固定响应的成功路径请求数不能增加，只有收尾说明不得再请求模型。完整自动化测试和打包属于实施后的验收，本轮没有重跑。

随后若获准真实复测，再用相同模型、推理档位、创意和生成体量比较修复前后。区分冷/热缓存、联网研究和正文输出、连接等待和生成时间；不能使用框架替换或离线实验来宣称文学质量已提高、耗时已达到某个数值或所有请求已超过 95% 缓存。

本次离线实验见 [脚本](../../output/pi-reuse-audit-0.4.79-20261028/offline-probe.ts) 和 [完整结果](../../output/pi-reuse-audit-0.4.79-20261028/offline-probe-result.json)。8 种模拟响应场景全部运行完成；所有 SDK fetch 均返回内存构造的 Response，真实网络/模型请求为 0。中文计数是额外的估算对照，不是服务端 token 实测。

官方同版本源码依据：[Agent 循环](https://github.com/earendil-works/pi/blob/v1.4.0/packages/agent/src/agent-loop.ts)、[Responses 适配器](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/api/openai-responses.ts)、[Responses 消息处理](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/api/openai-responses-shared.ts)、[Codex WebSocket](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/api/openai-codex-responses.ts)、[传输重试](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/utils/provider-retry.ts)、[Anthropic](https://github.com/earendil-works/pi/blob/v1.4.0/packages/ai/src/api/anthropic-messages.ts)、[压缩实现](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/compaction/compaction.ts)、[会话存储](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/src/core/session-manager.ts)。
