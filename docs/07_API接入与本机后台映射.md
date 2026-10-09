# API 接入与本机管理后台映射

审读范围：`D:\aiwangzhan\novel-platform` 的管理表单/预设、协议层、网关、HTTP 连接层与 Codex 桥接。没有读取 `.env`、密钥、运行数据库；没有测试真实端点。本文不是对该网站的完整安全审计。

用户最终决定：模型和端点自己设置，客户端提供完整入口。由此不必把某个型号写死，但不能将“任意 API 都能对接”当成无条件承诺。

## 1. 关键源码与职责

| 文件 | 已看到的实现 | 客户端处理 |
| --- | --- | --- |
| [平台预设](D:/aiwangzhan/novel-platform/apps/admin/src/lib/platform-presets.json) | 供应商名、基础地址、协议、native_protocols、compatible | 作为初始表单参考；标记为预设，不是能力认证 |
| [平台表单](D:/aiwangzhan/novel-platform/apps/admin/src/components/platform-form.tsx:428) | 选择厂商填入协议/地址；收集变量、账号、模型映射、脚本、超时 | 简化为作者能理解的连接与模型配置；高级项折叠 |
| [参考供应商目录](D:/aiwangzhan/novel-platform/contracts/reference-providers.json) | 官方、兼容、图像视频音乐等多类模板 | 首版文字与封面选用相关部分，不将目录所有能力都搬入需求 |
| [平台运行配置](D:/aiwangzhan/novel-platform/services/api/app/platform_configuration.py:1) | 多账号、变量、加密秘密、真实模型映射、协议别名、认证头 | 保留配置/运行投影分离；租户/组织/会员权限不直接搬入本地 |
| [原生协议](D:/aiwangzhan/novel-platform/services/api/app/provider_protocols.py:1) | 四类文字协议请求、文本/工具解析、原生结果续轮、模型目录分页 | 最有价值的协议契约参考；需补严格终止原因、流式和兼容测试 |
| [个人 API 预设](D:/aiwangzhan/novel-platform/services/api/app/personal_api_providers.py:1) | 国内厂商兼容地址、Gemini 原生、参数差异 | 预设与参数策略拆开；不要对所有同类模型硬塞 temperature |
| [网关](D:/aiwangzhan/novel-platform/services/api/app/gateway.py:26) | 请求前权限/预算/上下文；重试和路由；工具循环；请求/用量记录 | 复用设计而非搬入整套 SaaS 计费数据库 |
| [HTTP](D:/aiwangzhan/novel-platform/services/api/app/provider_http.py:1) | TLS 校验、连接池、认证/Cookie 状态隔离、无内容耗时日志 | 保留安全连接和错误分类；桌面代理设置重新验收 |
| [Codex 桥接](D:/aiwangzhan/novel-platform/services/api/app/codex_runtime.py:1) | 私有 loopback token、App Server 线程/轮次、工具代理、流式事件、中断 | 可选 Runner 的实物参考；当前 eligible 有 Responses 条件 |

完整源文件哈希另存 [API 参考清单](../analysis-2026-10-06/api-reference-manifest.json)。测试文件存在相关用例，但本次仅查看其范围和名称，没有运行网站测试，不将“有测试文件”等同于“测试通过”。

## 2. 四种协议不能只换 URL

下表描述本地 `provider_protocols.py` 的实现契约，不是对所有供应商当前服务的兼容保证。

| 内部协议 | 路径构造 | 认证 | 请求与返回特点 | 多轮必须保留 |
| --- | --- | --- | --- | --- |
| openai / Chat Completions | 根地址 + `/chat/completions` | Bearer | messages、tools.function；choices.message/tool_calls | tool_call_id；必要 reasoning_content；完整工具参数 |
| openai_responses | 根地址 + `/responses` | Bearer | instructions/input/max_output_tokens；output message/function_call | call_id、function_call_output、不透明加密推理块；终态 |
| anthropic | 根地址 + `/messages` | x-api-key、anthropic-version | system/messages、input_schema；content 的 text/tool_use | 完整 assistant blocks、tool_use_id/tool_result，必要签名块 |
| gemini | 根地址 + `/models/{id}:generateContent` | x-goog-api-key | systemInstruction/contents、functionDeclarations；candidates.parts | 原生 parts、thought signature、functionCall/Response 对应关系 |

基址语义固定为 API 根，不包含最终 operation。输入末尾多一个斜杠可规范化，用户已经填 `/responses` 时必须提示，不能再拼成 `/responses/responses`。模型名允许真实前缀或接入点 ID，不能全局替换掉厂商需要的前缀。模型显示名与发送到上游的真实 ID 分开。

Responses 分支检查 completed；其他协议解析分支不能仅凭存在文本就证明完成。客户端要进一步检查 length/max_tokens、内容过滤、空 candidates、缺 tool 参数、异常 stop_reason、断流缺终态。正文不完整时仍可保留候选，但不能自动接受为成稿。

## 3. NewAPI 与 sub2 api 的定位

预设中确有“NewAPI兼容平台”，默认走 openai，native_protocols 留空。示例地址属于源码预设，**不是你实际使用的服务地址，也未经本次实测确认**。在本次检索的源码/配置范围未见明确 sub2 api 专用适配标识；这不证明你的运行配置中不存在它，因为本次没有读取私密配置或数据库。

客户端将它们当作作者命名的连接配置：自填根地址、协议、认证和模型，按该端点实测能力运行。不能根据“NewAPI”“sub2”“兼容 OpenAI”几个字，自动勾选 Responses、工具、图片、用量和取消都支持。

同一供应商可能有原生和兼容入口，应允许两个 profile 分开测试。更改端点、Key、协议或真实模型后原能力结果失效；测试结果按配置版本和日期保存。

## 4. 设置页字段规格

| 分组 | 字段 | 验证与交互 |
| --- | --- | --- |
| 连接 | 连接名称、供应商预设/自定义、API 根地址、文字/图像能力类别 | 名称不等于协议；HTTPS 默认，本地 HTTP 明确标为本机服务 |
| 协议 | Chat Completions / Responses / Anthropic / Gemini / 已安装图像适配器 | 不允许模型自己根据 URL 猜完就直接运行 |
| 凭据 | API Key 或支持的自定义认证头；系统密钥引用 | 显示遮罩、可替换/删除；空白保存不清空旧 Key，清空用独立动作 |
| 模型 | 手填真实 ID、拉取目录、显示名、模型能力、上下文上限、输出上限 | 目录选择可编辑；未知上下文不能无限猜大 |
| 参数 | temperature/top_p、思考参数、输出格式等适配器认可选项 | 默认沿用模型；不支持参数禁止传送；高级 JSON 仍须 schema 校验 |
| 网络 | 直连/系统代理/自定义代理、连接和读取超时 | TLS 校验保持；不把关闭证书验证作为常规解决方案 |
| 费用 | 输入/输出/缓存价格、币种、单位、来源日期、阶段预算 | 可不填金额，显示未知；至少保留调用数与输出上限 |
| 测试 | 获取模型目录、文本、流式、工具续轮、用量、中断 | 免费读取与可能计费测试分开，展示具体请求范围 |
| 路由 | 作品默认、规划/正文/审阅/记忆/封面各阶段选择 | 当前 Run 绑定版本；切换不篡改已开始调用 |

原后台的多账号池、会员折扣、组织白名单、轮询/最小负载、Redis 并发等不是个人 BYOK 的必需项。客户端可保存多个连接，但不默认自动用另一 Key 重试一个受理情况不明的请求。

原后台提供自定义提交脚本和 AccessKey 签名路径。首版如果支持高级适配脚本，必须使用终端/脚本同一权限体系，签名认证必须实际实现并测试；不能因为设置页有 AccessKey 输入框就声称已对接签名厂商。

## 5. 能力矩阵与验收级别

每项取值为 unknown / declared / verified / failed，不采用简单“兼容=true”。最低文字 Agent 配置必须支持文字响应和可用的工具回环；不支持原生工具的模型可以仅用于确定性的单步生成任务，界面不能把它显示为完整自主执行器。

| 能力 | 探测内容 | 失败时行为 |
| --- | --- | --- |
| models.list | 有界分页、ID 保留、错误响应 | 允许手填模型，不因此判定生成必不可用 |
| text | 小请求返回完整文本和终态 | 不允许写作任务启用该配置 |
| stream.text | 中文分片、空片、断流、结束事件 | 可退到非流式（明确说明）；不能假装实时输出 |
| tools.single | 调用一个无副作用测试工具，解析 schema | 完整 Agent 不可用；不能执行模型吐出的任意代码补偿 |
| tools.roundtrip | 调用→结果回传→下一轮文本 | 标记只支持单轮不足以运行 Agent |
| tools.parallel | 多 call id、分片参数和结果对应 | 降为串行能力，不错配返回结果 |
| usage | 输入/输出/缓存/推理用量类型 | 显示缺失/估算，不能填零冒充准确 |
| cancel | 本地取消和可选上游取消 | 声明取消的真实范围；不承诺退款 |
| images | 生成、格式、尺寸、返回 URL/二进制 | 封面能力单独失败，不影响文字 profile |
| edit.image | 图片编辑/参考图（若适配器支持） | 禁用相关按钮，不将普通生成包装成编辑 |

大量预设在源码中直接声明多种协议，只能算 declared。本次未调用真实端点，所有对你实际服务的兼容性仍应显示 unknown。

## 6. 请求状态、错误与费用

推荐状态：prepared → admitted → sending → receiving → completed；另外有 rejected、failed_before_send、cancelled_before_send、interrupted_after_send、unknown。只有明确未发送或被明确拒绝的请求，才按策略安全重试。网络读取超时和收到半截内容，不等于服务商没有处理。

记录 requestId、attempt、配置版本、请求 hash、时间、提交状态、上游关联 ID、部分内容路径和用量。失败时保留脱敏诊断，Key、认证头、完整私密提示不默认进入日志。未知费用作为待核对状态，不阻止作者离线编辑，但不能驱动自动额外调用。

费用公式按端点价目配置：输入与输出分别乘单价，缓存/推理按服务商口径处理。所有单价须有单位、币种和生效版本。不在本文填写瞬时模型价格，不推断中转价格等于官方价格。

网站网关对平台计费使用 pending_reconciliation；个人 API 分支多处记录 failed 且提示可能已计费。客户端应进一步保留 `submittedState=unknown`，即使不向用户收平台费用，也要防止重复消耗自己的 Key。

## 7. Codex 桥接能复用什么

本机 `codex_runtime.py` 已实现独立 home/workspace、短期 loopback token、thread/start/resume、turn/start/interrupt、真实工具事件和受限小说工具。系统提示、规则文件与项目读写通过网站网关管理。

限制同样具体：eligible 依赖 Responses；一些工具注册字段具有版本敏感性；桥接存在长时间等待、服务器租约/会话、数据库依赖。本次没有将其运行在 Windows 桌面，也没有证明用户端点可处理完整往返。设计应抽出“执行器适配”，保留本地阶段批准和文件服务，不直接把整个网站 runtime 复制进主进程。

官方 App Server 支持这种客户端集成边界；当前推荐首版统一自建多协议 Runner，保留替换接口。若后续验证 Responses-only 路线能更快且更稳，允许有证据地变更推荐。[官方文档](https://developers.openai.com/codex/app-server)

## 8. 开发交付要求

交付四种协议的录制或合成 fixture、至少一条两轮工具调用、中文流式中断、非法参数、重复 call id、无 usage、错误终态、错误基址、代理/TLS、Key 替换和脱敏测试。图像适配器独立测试；用于最终联调的具体端点由作者在设置页填写。

本次文档阶段无需你交出 Key。开发后的真实联调必须由客户端用你选择的服务进行；在那之前不能将设置页展示的厂商数量当成已支持的厂商数量。
