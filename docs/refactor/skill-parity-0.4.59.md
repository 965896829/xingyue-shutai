# 0.4.59：按容量压力交接，保留真实缓存与服务端诊断

0.4.58 完整运行 52 分 37.156 秒，18 个请求，实际缓存 60.46%。同任务后续请求 99.14%，任务入口 41.22%。客户端有三次规划重建和四次 S10 强制重建；客户端 JSON 前缀相同不等于服务器存在可匹配缓存。这是本次修复的直接证据，不能仅用字节减少预测速度。

改为以成功回执计量的请求前缀加未计量后缀的保守上界判断容量压力，阈值为可用输入的 80%。不再因为可减少 25% 文本就主动重建。工具与原生回复完整匹配时，上一回复的实际 output tokens 可用于容量折算，附加协议余量；缺用量、错版本或错 native 时继续保守计算。原始密文和日志始终保留，未把密文字节当作真实 token。

S10 从已采纳 S09 的节点派生；相邻子任务可复用前一子任务首次成功请求的输入，但不继承其生成的推理、工具动作、自评和审稿判断。该输入节点按同一运行、epoch、章节、快照、规则和正文版本校验，重启后仍可使用；失败请求不发布节点，修订、换规则或换正文版本时重新组装。接近容量上限时仍使用完整当前来源和当前任务原生工具链重建，保存作者任务与补充要求。来源仍是 user 数据，不提升为 developer 指令，工具权限与事实验证不变。

正文和审稿的共同表达规则保留为相同版本块，审稿新增的 EDIT 模块单独追加；不再因为增加编辑规则而重复发送整个补充规则块。逐项检查触发、处理、例外和保护条件均存在，适用模式仍由当前任务决定。未缩减生效规则或必需模板字段。

已知支持的 gpt-5.6 系列及 gpt-6.1-sol 在此缓存会话中明确使用 reasoning.context=all_turns，保持冻结的 high 推理强度。仅使用已有的不透明推理项目，不生成摘要调用。模型、实际 service_tier、reasoning.context、缓存诊断和请求时序只保存上游实际返回的数据；缺省值仍未知，不以客户端设置代替回执。Sub2/OAuth 曾拒绝显式缓存断点，本版不重试此参数，也不使用预热请求。

参考架构和支持范围：

- [DeepSeek Harness config.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/compaction/compaction-basic/src/config.ts)：按请求压力触发，默认阈值 0.8。这里只借鉴触发方式，不引入其模型摘要请求。
- [DeepSeek Harness region.ts](https://github.com/deepseek-ai/deepseek-harness/blob/687f282e8625c6b8d11ff58211a90524be2e4317/packages/compaction/compaction-basic/src/region.ts)：完整记录和可见上下文分离、安全工具边界、压缩事务。
- [Codex client.rs](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/core/src/client.rs#L959)：Responses Lite 根据模型能力选择 all_turns；同文件说明 ChatGPT 的 session-id 缓存亲和性。已检查 Sub2 会由现有稳定 prompt_cache_key 派生隔离的 session_id，未额外改动中转。
- [DeepSeek Harness 追加式审查输入记录](https://github.com/deepseek-ai/deepseek-harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/.agents/notes/implemented/feature/2026-08-28-auto-review.md)：稳定消息边界和只追加的材料排列。这里仅借鉴前缀布局，不引入它的工具审批流程或额外模型审查。
- [OpenAI reasoning](https://developers.openai.com/api/docs/guides/reasoning#preserve-reasoning-across-calls)、[prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching)、[diagnostics](https://developers.openai.com/api/docs/guides/prompt-caching/diagnostics)：前缀、断点、推理上下文和诊断的支持与限制。公开 API 能力不代表 OAuth 全部支持；未发送额外诊断探针。

原 Skill 基础文件、模板、流程职责、字数、校验、12 轮上限和 gpt-6.1-sol/high 保持不变。旧版完整实跑记录不修改。以新版本冻结后的独立死亡权运行核对全部输出、结构、实际用量和时间。总命中率及每次请求均展示，包含冷启动；95% 是实测验收目标，不是客户端能承诺的供应商保证。测试和离线回放不代表文学质量或线上性能通过。
