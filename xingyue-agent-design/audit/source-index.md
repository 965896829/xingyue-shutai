# 来源索引 V7

审计基线：0.4.82，提交 b505f6f459db74871f39f63acf6106b827c8a353。本轮核验日期：2026-10-29。

保留前序来源与当时范围。V5F 为番茄官方页面与公开前端依赖，V5C 为项目代码，V5V 为可视化组件和写作工具，V5W 为世界建模与派生图参考。设计、原创示例和工程选择不是平台市场结论。

## C01 项目版本与仓库结构

[项目版本与仓库结构](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/package.json)

0.4.82 固定提交；README 同版本。

## C02 表达规则选择与阶段装载

[表达规则选择与阶段装载](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/expression-rules.ts)

158—199 行及本包本地展开结果。

## C03 系统提示词组装

[系统提示词组装](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/skill.ts)

输出模式、命名、模板合同；另见 skill-registry.ts。

## C04 正文与记忆调用链

[正文与记忆调用链](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runner.ts)

939—1438 行；writer、preview、记忆与审核。

## C05 叙事评估与节点协议

[叙事评估与节点协议](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/telemetry.ts)

153—262 行；另见 src/shared/narrative-events.ts。

## C06 现有文风体系

[现有文风体系](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/resources/skill/runtime/references/style-system.md)

十维、场景规则；另见 webnovel-voice-profile/SKILL.md。

## C07 人物声线抽取

[人物声线抽取](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/character-voice.ts)

字面实体选择与声音字段切片。

## C08 正文编辑线索

[正文编辑线索](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/prose-editorial.ts)

重复与解释等证据；不是 AI 身份概率。

## C09 三方向与完整方案执行

[三方向与完整方案执行](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/tag-planning.ts)

工具提交、结束、模板与候选流程。

## C10 方向报告验证

[方向报告验证](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/tags.ts)

冻结 assumptions 与方向 ID 检查。

## C11 五项审稿合同

[五项审稿合同](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/manuscript-check.ts)

aspect、verdict、原文证据。

## C12 作者文档模板约束

[作者文档模板约束](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/skill-output-contract.ts)

拒绝额外二级标题；另见 validation.ts。

## C13 数据权威与持久化

[数据权威与持久化](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/docs/refactor/data-authority.md)

SQLite、来源对象、候选、事务、未知请求。

## C14 现有正文评测脚本

[现有正文评测脚本](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/scripts/prose-eval.ts)

离线信号回归，非文学盲评。

## C15 创意提示词与重做范围

[创意提示词与重做范围](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/creation-prompts.ts)

资源锁、regenerationScope、历史与版本分支。

## C16 正式采纳事务

[正式采纳事务](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/commit-kernel.ts)

本地批准与正式提交；另见 storage.ts。

## C17 现有缓存输入布局

[现有缓存输入布局](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/prompt-cache.ts)

共享规则、来源前缀与动态信息。

## C18 上下文编译

[上下文编译](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/context-compiler.ts)

必需材料、角色、知情与来源过滤。

## C19 原字段与来源复用

[原字段与来源复用](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/source-reuse.ts)

S08 等字段与版本来源复用。

## C20 阶段采纳推进

[阶段采纳推进](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/service.ts)

982—1005、2017—2018 行；另见 domain.ts。

## R01 Pi 官方仓库

[Pi 官方仓库](https://github.com/earendil-works/pi)

核验 a92283056d915c758799fcd904948ff0cb42628c；agent-core 1.4.0；MIT。

## R02 LangGraph 中断与恢复

[LangGraph 中断与恢复](https://docs.langchain.com/oss/python/langgraph/interrupts)

核验 2026-10-28；节点恢复重跑及幂等副作用。

## R03 DeepAgents 概览

[DeepAgents 概览](https://docs.langchain.com/oss/python/deepagents/overview)

核验 2026-10-28；按需 skills 与上下文组织。

## R04 Letta Agent SDK Memory

[Letta Agent SDK Memory](https://docs.letta.com/agent-sdk/memory)

核验 2026-10-28；当前 MemFS；源码 letta-ai/letta-code。

## R05 novel-studio 官方仓库

[novel-studio 官方仓库](https://github.com/Xiaoyangy/novel-studio)

核验 ed04a106f665f456246af3c4414ba62992a2a1d1；v0.3.0；Apache-2.0。

## R06 MuMuAINovel 发行版

[MuMuAINovel 发行版](https://github.com/xiamuceer-j/MuMuAINovel/releases/tag/v1.5.7)

2026-10-16；官方 canonical；GPL-3.0。

## R07 AI_NovelGenerator 当前主线

[AI_NovelGenerator 当前主线](https://github.com/YILING0013/AI_NovelGenerator)

核验 a61674fad4dd6c4c5fa9a2ad2f12b667109e628a；AGPL-3.0。

## R08 OpenAI Harness engineering

[OpenAI Harness engineering](https://openai.com/index/harness-engineering/)

2026-02-11；短规则导航与结构化知识的工程经验。

## R09 Anthropic 上下文工程

[Anthropic 上下文工程](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents)

2025-09-29；高相关上下文与检索组织。

## R10 OpenAI Agent improvement loop

[OpenAI Agent improvement loop](https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop)

2026-05-12；轨迹、反馈、回放与改进。

## R11 OpenAI Evals 生命周期

[OpenAI Evals 生命周期](https://developers.openai.com/api/docs/guides/evals)

2026-10-28 核验；10-31 只读、11-30 计划关闭。

## R12 番茄 人物活人感课程

[番茄 人物活人感课程](https://fanqienovel.com/writer/zone/article/7612544314719076376)

2026-03-02；平台发布的创作经验。

## R13 番茄 单章修改与节奏课程

[番茄 单章修改与节奏课程](https://fanqienovel.com/writer/zone/article/7626644363652644889)

2026-04-09；局部与结构问题、阅读反馈。

## R14 番茄 推荐验证全指南

[番茄 推荐验证全指南](https://fanqienovel.com/writer/zone/article/7659317147297923134)

2026-07-08；较二月规则更新，以本次已核验版本为准。

## R15 番茄 九月低质治理公告

[番茄 九月低质治理公告](https://fanqienovel.com/writer/zone/article/7698999877673418776)

2026-10-21；文字、结构与收尾质量。

## R16 Re3

[Re3](https://aclanthology.org/2022.emnlp-main.296/)

EMNLP 2022；递归提示与修订的长故事研究。

## R17 DOC

[DOC](https://aclanthology.org/2023.acl-long.190/)

ACL 2023；分层细纲与生成控制。

## R18 Doshi 与 Hauser 创意辅助研究

[Doshi 与 Hauser 创意辅助研究](https://discovery.ucl.ac.uk/id/eprint/10195027/)

Science Advances 2024；短故事质量与集体相似性实验。

## C21 现有工作台布局

[现有工作台布局](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/App.tsx)

936—984 与 1442—1497 行；MemoryStudio、讨论与右侧作品面板。

## C22 人物与故事检查器

[人物与故事检查器](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/ManuscriptInspector.tsx)

角色资料、状态、直接关系和故事分类。

## C23 记忆工作台视角和章节范围

[记忆工作台视角和章节范围](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/MemoryStudio.tsx)

截至章节、历史快照、作者读者人物视角。

## C24 叙事曲线面板

[叙事曲线面板](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/NarrativePanel.tsx)

本章、章节走势与维度对照。

## C25 共创讨论与版本化行动提案

[共创讨论与版本化行动提案](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/conversation-runner.ts)

166—240、408—449 行；提案、过期检查与创作讨论。

## C26 会话与自由草稿持久化

[会话与自由草稿持久化](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/conversations.ts)

21—79、104—155 行；聊天分页和草稿版本。

## C27 会话与提案数据合同

[会话与提案数据合同](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/shared/assistant.ts)

candidateEdit 与 ActionProposal。

## C28 正式变更提交

[正式变更提交](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/storage.ts)

614—719 行；审批绑定、changeset、快照与日志。

## R19 Wordcraft 官方仓库

[Wordcraft 官方仓库](https://github.com/PAIR-code/wordcraft/blob/main/README.md)

2026-10-28 核验；自然语言操作与编辑器状态组合。

## R20 Wordcraft Writers Workshop

[Wordcraft Writers Workshop](https://magenta.withgoogle.com/wordcraft-writers-workshop)

2022-12-01；专业作者使用与反馈，作为交互研究参考。

## R21 React Flow 自定义节点

[React Flow 自定义节点](https://reactflow.dev/learn/customization/custom-nodes)

2026-10-11 更新；可作为后续节点编辑的实现选项。

## MR01 Graphiti official repository

[Graphiti official repository](https://github.com/getzep/graphiti)

Apache-2.0; temporal facts and episode provenance; Python 3.10+ and graph backend; FalkorDBLite extra needs Python 3.12+.。

## MR02 Graphiti releases

[Graphiti releases](https://github.com/getzep/graphiti/releases)

Latest v0.31.2, 20 Oct 17:25, commit d72407d; prior v0.31.1 and v0.31.0 visible.。

## MR03 Hindsight architecture overview

[Hindsight architecture overview](https://hindsight.vectorize.io/)

World, experience, observation, mental model and knowledge page distinctions; observation sources/history/freshness; disposition shapes reflect only, recall does not vary automatically by asker.。

## MR04 Hindsight mental models

[Hindsight mental models](https://hindsight.vectorize.io/developer/mental-models)

Curated standing answer to a bank question; refreshed in background; reading it is a database read rather than new retrieval/synthesis/model call.。

## MR05 Introducing Hindsight Memlake

[Introducing Hindsight Memlake](https://hindsight.vectorize.io/blog/2026/10/13/memlake)

Memlake is Enterprise/Cloud; open source remains on Postgres. Performance footnotes exclude cross-encoder reranker and disclose workload/configuration limits. Do not attribute Memlake's large-scale latency numbers to the MIT local Postgres product.。

## MR06 Mem0 official repository and April 2026 algorithm

[Mem0 official repository and April 2026 algorithm](https://github.com/mem0ai/mem0)

ADD-only extraction; multi-signal retrieval; platform benchmark includes proprietary optimizations absent from open-source SDK; Apache-2.0. Vendor-managed-platform results, not evidence of local SDK equivalence or fiction quality.。

## MR07 Mem0 current platform graph-memory documentation

[Mem0 current platform graph-memory documentation](https://github.com/mem0ai/mem0/blob/main/docs/platform/features/graph-memory.mdx)

Native entity-memory co-occurrence connections boost retrieval; does not assign typed labeled relationships; old relations payload now empty. Platform documentation, not an assertion about every older open-source graph integration.。

## MR08 Mem0 releases

[Mem0 releases](https://github.com/mem0ai/mem0/releases)

Visible latest release list includes Python v2.2.1 and Node v3.3.1; Python v2.2.1 dated 25 Sep, commit 94c3fe9.。

## MR09 MAGMA: A Multi-Graph based Agentic Memory Architecture for AI Agents

[MAGMA: A Multi-Graph based Agentic Memory Architecture for AI Agents](https://aclanthology.org/2026.acl-long.1709/)

ACL July 2026; semantic, temporal, causal and entity graphs; query-adaptive traversal and transparent retrieval paths. Research evidence on conversational benchmarks; not a production or fiction-quality guarantee.。

## MR10 MAGMA official repository

[MAGMA official repository](https://github.com/FredJiang0324/MAGMA)

MIT, Python 3.9+; research evaluation scripts for LoCoMo and LongMemEval; configurable traversal limits.。

## MR11 HELM: Steering Long-Horizon Agents with Learned Hierarchical Memory and Epistemic Governance

[HELM: Steering Long-Horizon Agents with Learned Hierarchical Memory and Epistemic Governance](https://aclanthology.org/2026.emnlp-main.721/)

EMNLP October 2026; evidence status, source/version/freshness governance; auditable hierarchical recalls; training-free/governance-only ablations. Official PDF names https://github.com/Galleons2029/HELM; repository fetch failed in this run, so no claim about its current license or release.。

## MR12 LightRAG official README

[LightRAG official README](https://github.com/HKUDS/LightRAG/blob/main/README.md)

Incremental document-oriented pipeline; deletion with graph regeneration; reranking; query context exposure for evaluation; 2026 extraction/chunking updates.。

## MR13 From RAG to Memory: Non-Parametric Continual Learning for Large Language Models

[From RAG to Memory: Non-Parametric Continual Learning for Large Language Models](https://proceedings.mlr.press/v267/gutierrez25a.html)

ICML 2025 HippoRAG 2 paper; deeper passage integration and Personalized PageRank support associative retrieval while preserving factual-task performance. Claims are author's task-specific evaluations, not direct measurements on this novel client.。

## MR14 Letta MemFS official documentation repository

[Letta MemFS official documentation repository](https://github.com/letta-ai/letta-docs-md/blob/main/concepts/memfs/index.md)

Git-backed memory repository, version history, commits and worktrees; local/cloud behavior distinguished.。

## MR15 Letta Code official repository

[Letta Code official repository](https://github.com/letta-ai/letta-code)

Current code location; Apache-2.0 license.。

## MR16 Beyond a Million Tokens: Benchmarking and Enhancing Long-Term Memory in LLMs

[Beyond a Million Tokens: Benchmarking and Enhancing Long-Term Memory in LLMs](https://proceedings.iclr.cc/paper_files/paper/2026/hash/d7f0cfa0fe759b033d5262e1bb7d4065-Abstract-Conference.html)

ICLR 2026; BEAM 100 conversations and 2000 validated questions up to 10M tokens; LIGHT combines episodic, working memory and scratchpad. Long conversational benchmark; token length is not Chinese novel character length.。

## MR17 BEAM official project and code

[BEAM official project and code](https://github.com/mohammadtavakoli78/BEAM)

Multi-scale conversations and code; memory abilities include contradiction resolution, event ordering and instruction following.。

## MR18 LongMemEval official repository

[LongMemEval official repository](https://github.com/xiaowu0162/longmemeval)

500 questions across extraction, multi-session reasoning, knowledge updates, temporal reasoning and abstention.。

## MR19 LangGraph persistence

[LangGraph persistence](https://docs.langchain.com/oss/javascript/langgraph/persistence)

Checkpointers persist thread state; stores hold cross-thread data; in-memory saver is not restart durable.。

## MR20 LightRAG release history

[LightRAG release history](https://github.com/HKUDS/LightRAG/releases)

Latest stable v1.5.7, 2 Sep, commit 28ff1b0; release includes graph-first ingestion with deferred vector indexing.。

## MR21 Hindsight official repository

[Hindsight official repository](https://github.com/vectorize-io/hindsight)

MIT official source; client/server components and deployment references.。

## MR22 Hindsight release history

[Hindsight release history](https://github.com/vectorize-io/hindsight/releases)

Latest v1.1.0, 21 Oct 16:41, commit a5a619b.。

## MR23 SQLite Vec1 Vector Extension

[SQLite Vec1 Vector Extension](https://www.sqlite.org/vec1.html)

Current 0.8; portable C; IVFADC with OPQ; L2/cosine; no external dependencies; updated 2026-10-01. Novel local backend candidate, not yet integrated or benchmarked in this project.。

## MR24 SQLite Vec1 User Manual

[SQLite Vec1 User Manual](https://www.sqlite.org/vec1doc.html)

NN and ANN modes; ANN requires trained model; small vector collections may favor exact search; filtering and reranking documented.。

## MR25 sqlite-vec official repository

[sqlite-vec official repository](https://github.com/asg017/sqlite-vec)

Portable C, Node bindings, metadata/partition columns, pre-v1 warning; current main includes DiskANN/IVF source files. Main-branch code presence is not proof of stable released ANN support. Verify pinned release before selecting.。

## MR26 SQLite FTS5 official documentation

[SQLite FTS5 official documentation](https://www.sqlite.org/fts5.html)

Trigram full-text queries do not match substrings shorter than three Unicode characters; external-content index consistency is caller responsibility.。

## MR27 Hindsight recall architecture

[Hindsight recall architecture](https://hindsight.vectorize.io/developer/retrieval)

Four strategy searches; rank fusion; reranking; token budget; source chunks can be retrieved for nuance; text backends distinguish genuine BM25 from native TF-IDF and offer Chinese tokenizers.。

## MR28 Hindsight observations

[Hindsight observations](https://hindsight.vectorize.io/developer/observations)

Official documentation for automatic knowledge consolidation; see overview for directly inspected evidence/history/freshness behavior.。

## MR29 TSHMem: A Temporal-Semantic Hierarchical Memory Graph for Long-Term Conversational Agents

[TSHMem: A Temporal-Semantic Hierarchical Memory Graph for Long-Term Conversational Agents](https://aclanthology.org/2026.emnlp-main.1034/)

EMNLP October 2026; temporal intent, entities, statements and hierarchical summaries; time-aware propagation and semantic matching. Research candidate. PDF fetch failed; no repository license/implementation claim made.。

## MR30 HippoRAG official repository

[HippoRAG official repository](https://github.com/OSU-NLP-Group/HippoRAG)

MIT, official HippoRAG/HippoRAG 2 code and evaluation resources.。

## CM01 Generative Agents: Interactive Simulacra of Human Behavior

[Generative Agents: Interactive Simulacra of Human Behavior](https://arxiv.org/abs/2304.03442)

经历、检索、反思、计划分层；限定作者控制；社会模拟研究，不是长篇小说成效验证。

## CM02 Concordia

[Concordia](https://github.com/google-deepmind/concordia)

实体组件、观察分发、行动与结果分离、状态保存；Python 社会模拟库；建议复用设计边界，不作为客户端默认依赖。

## CM03 CoSER: Coordinating LLM-Based Persona Simulation of Established Roles

[CoSER: Coordinating LLM-Based Persona Simulation of Established Roles](https://proceedings.mlr.press/v267/wang25dk.html)

给定具体处境评测人物行动、声音与经历一致性；不引入书籍语料；评分受 judge 版本影响，不等价于网文阅读效果。

## CM04 EmoCharacter: Evaluating the Emotional Fidelity of Role-Playing Agents in Dialogues

[EmoCharacter: Evaluating the Emotional Fidelity of Role-Playing Agents in Dialogues](https://aclanthology.org/2025.naacl-long.316/)

情感忠实度单列评价；人物情感评价不是心理测量，不以通用模型能力替代。

## CM05 REMP: A Structured Event-Probing Benchmark for Long-Horizon Role-Playing Dialogue

[REMP: A Structured Event-Probing Benchmark for Long-Horizon Role-Playing Dialogue](https://aclanthology.org/2026.findings-emnlp.602/)

人格、情绪、记忆、关系的长程事件探针；仅核验官方摘要与书目；PDF 在本工具中不可访问，未复现。

## CM06 RoleMemo / DualMem

[RoleMemo / DualMem](https://github.com/Collab-Gen/RoleMemo)

事实与人物视角解释分开保存；initial release；数据、权重、完整 recurrent RL agent 仍 coming soon；只借鉴机制。

## CM07 ToMBench: Benchmarking Theory of Mind in Large Language Models

[ToMBench: Benchmarking Theory of Mind in Large Language Models](https://github.com/zhchen18/ToMBench)

知识、错误信念、意图、愿望与非字面沟通测试；官方题库仅用于评测；项目采用原创回归用例。

## MC01 事实、证据、时间、人物知情合同

[事实、证据、时间、人物知情合同](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/shared/types.ts)

192-259 行；固定提交源码核验。

## MC02 记忆作用域与角色状态

[记忆作用域与角色状态](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/shared/studio.ts)

36-61 行；固定提交源码核验。

## MC03 证据校验与重建

[证据校验与重建](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/memory-records.ts)

37-153 行；固定提交源码核验。

## MC04 范围过滤、全量检索、角色状态、误解可见性

[范围过滤、全量检索、角色状态、误解可见性](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/memory-studio.ts)

25-157,242-342 行；固定提交源码核验。

## MC05 表结构、全量事实保存、快照、事务与依赖失效

[表结构、全量事实保存、快照、事务与依赖失效](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/storage.ts)

173-208,339-416,614-719,807-866 行；固定提交源码核验。

## MC06 全台账必读注入及独立审核

[全台账必读注入及独立审核](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runner.ts)

1156-1179,1358-1423 行；固定提交源码核验。

## MC07 分块、逐块向量请求、全量余弦及RRF

[分块、逐块向量请求、全量余弦及RRF](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/embeddings.ts)

89-144,184-252,278-409 行；固定提交源码核验。

## MC08 预算、章节切片、强约束与多次扫描

[预算、章节切片、强约束与多次扫描](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/context-compiler.ts)

39-63,78-166 行；固定提交源码核验。

## MC09 FTS索引与查询

[FTS索引与查询](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/prose-index.ts)

7-65 行；固定提交源码核验。

## MC10 已有增量快照与127层检查点

[已有增量快照与127层检查点](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/snapshot-codec.ts)

17-59 行；固定提交源码核验。

## MC11 同版本提取与语义审核

[同版本提取与语义审核](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/memory-review.ts)

7-105 行；固定提交源码核验。

## MC12 状态变化、未来计划与修订边界

[状态变化、未来计划与修订边界](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/story-impact.ts)

20-63,78-120 行；固定提交源码核验。

## MC13 事实替换区间、台账物化与重建

[事实替换区间、台账物化与重建](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/service.ts)

2092-2135,2284-2299 行；固定提交源码核验。

## MC14 已有动态角色与增量提取规则

[已有动态角色与增量提取规则](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/resources/skill/runtime/skills/webnovel-memory-extractor/SKILL.md)

固定提交源码核验。

## MC15 已有情绪、行为、动机承接字段

[已有情绪、行为、动机承接字段](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/resources/skill/runtime/references/templates/章后更新模板.md)

固定提交源码核验。

## MC16 500章检索、10万向量和增量历史测试源码

[500章检索、10万向量和增量历史测试源码](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/large-book.test.ts)

15-113 行；固定提交源码核验。

## MC17 5千万字合成容量脚本及测试范围

[5千万字合成容量脚本及测试范围](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/large-book.ts)

16-17,28-35,61-65,83-117 行；固定提交源码核验。

## MC18 记忆安全、正常状态演变与未来计划同步测试源码

[记忆安全、正常状态演变与未来计划同步测试源码](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/memory-safety.test.ts)

71-455 行；固定提交源码核验。

## MC19 预算、来源、知情、历史与范围测试源码

[预算、来源、知情、历史与范围测试源码](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/context-compiler.test.ts)

48-272 行；固定提交源码核验。

## MC20 六项合成状态与干扰长度评测源码

[六项合成状态与干扰长度评测源码](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/scripts/context-eval.ts)

19-38 行；固定提交源码核验。

## MC21 分词估计、保守上界与预算

[分词估计、保守上界与预算](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/context-budget.ts)

13-60 行；固定提交源码核验。

## NR01 Narrative World Model

[Narrative World Model](https://arxiv.org/html/2607.05577v1)

2026-07-06 预印本；小说状态与查询相关检索；生成评价仍属后续工作。

## NR02 ConStory Bench 官方仓库

[ConStory Bench 官方仓库](https://github.com/Picrew/ConStory-Bench)

ACL 2026；五类十九项故事一致性问题；作为评测维度参考。

## NR03 MINTEval

[MINTEval](https://arxiv.org/abs/2605.18565)

2026-05 v2；更新干扰与多目标聚合记忆；早期检索记录使用旧名 LongMINT。

## NR04 LongMemEval V2

[LongMemEval V2](https://xiaowu0162.github.io/longmemeval-v2/)

2026；长期网页轨迹记忆和动态状态评测，非小说效果验证。

## NR05 AMA Bench

[AMA Bench](https://proceedings.mlr.press/v306/zhao26bs.html)

ICML 2026；因果与客观信息的长程记忆评价。

## V4S01 Agent Skills Specification

[Agent Skills Specification](https://agentskills.io/specification)

SKILL.md format, metadata, experimental allowed-tools, progressive disclosure；2026-10-29 核验。

## V4S02 Adding Skills Support

[Adding Skills Support](https://agentskills.io/client-implementation/adding-skills-support)

catalog/filtering/activation/compaction/dedup/optional subagents；2026-10-29 核验。

## V4S03 Agent Skills repository

[Agent Skills repository](https://github.com/agentskills/agentskills)

Apache-2.0；2026-10-29 核验。

## V4S04 Pi v1.4.0 release

[Pi v1.4.0 release](https://github.com/earendil-works/pi/releases/tag/v1.4.0)

2026-10-21; 4a08025；2026-10-29 核验。

## V4S05 Pi v1.4.0 skills

[Pi v1.4.0 skills](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/skills.md)

instructions and resources vs prompt templates；2026-10-29 核验。

## V4S06 Pi v1.4.0 extensions

[Pi v1.4.0 extensions](https://github.com/earendil-works/pi/blob/v1.4.0/packages/coding-agent/docs/extensions.md)

executable integration and same-process OS permissions；2026-10-29 核验。

## V4S07 Anthropic Skill Creator

[Anthropic Skill Creator](https://github.com/anthropics/skills/blob/main/skills/skill-creator/SKILL.md)

baseline, blind comparisons, trigger tests；2026-10-29 核验。

## V4S08 Anthropic Skills repository

[Anthropic Skills repository](https://github.com/anthropics/skills)

mixed licenses; demonstrations not production assurance；2026-10-29 核验。

## V4S09 Claude Agent SDK skills

[Claude Agent SDK skills](https://code.claude.com/docs/en/agent-sdk/skills)

skill allowlist not filesystem restriction; allowedTools preapproves not exclusion；2026-10-29 核验。

## V4S10 Claude Agent SDK v0.3.312 release

[Claude Agent SDK v0.3.312 release](https://github.com/anthropics/claude-agent-sdk-typescript/releases/tag/v0.3.312)

2026-10-27; e296380；2026-10-29 核验。

## V4S11 Claude Agent SDK repository

[Claude Agent SDK repository](https://github.com/anthropics/claude-agent-sdk-typescript)

Commercial Terms；2026-10-29 核验。

## V4S12 LangGraph Functional API

[LangGraph Functional API](https://docs.langchain.com/oss/javascript/langgraph/functional-api)

checkpoint replay; unfinished task can rerun; idempotency；2026-10-29 核验。

## V4S13 LangGraph JS 1.5.3 release

[LangGraph JS 1.5.3 release](https://github.com/langchain-ai/langgraphjs/releases/tag/@langchain%2Flanggraph@1.5.3)

2026-10-26; b09eb06；2026-10-29 核验。

## V4S14 LangGraph JS repository

[LangGraph JS repository](https://github.com/langchain-ai/langgraphjs)

MIT；2026-10-29 核验。

## V4S15 SkillsBench 1.1

[SkillsBench 1.1](https://www.skillsbench.ai/blogs/skillsbench-1-1)

2026-06-16 release article; 87 tasks/8 domains; paired eval; Apache2；2026-10-29 核验。

## V4S16 SkillsBench v1.1 release

[SkillsBench v1.1 release](https://github.com/benchflow-ai/skillsbench/releases/tag/v1.1)

2026-06-14; b63b7b2; 87 tasks；2026-10-29 核验。

## V4S17 Skill Creator license

[Skill Creator license](https://github.com/anthropics/skills/blob/main/skills/skill-creator/LICENSE.txt)

Apache-2.0；2026-10-29 核验。

## V4S18 Pi repository

[Pi repository](https://github.com/earendil-works/pi)

MIT; upstream rename；2026-10-29 核验。

## V4C01 技能注册、宿主分类、路径限制、装配、资源锁

[技能注册、宿主分类、路径限制、装配、资源锁](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/skill-registry.ts)

固定提交 9-127；2026-10-29 本地源码核验。

## V4C02 工具白名单、工具调用和候选范围检查

[工具白名单、工具调用和候选范围检查](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runner.ts)

固定提交 184-195;1490-1596；2026-10-29 本地源码核验。

## V4C03 阶段和 mode 输出协议，命名与表达规则

[阶段和 mode 输出协议，命名与表达规则](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/skill.ts)

固定提交 86-144；2026-10-29 本地源码核验。

## V4C04 Pi 调度边界，宿主负责真实请求和回执

[Pi 调度边界，宿主负责真实请求和回执](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/task-loop.ts)

固定提交 40-125；2026-10-29 本地源码核验。

## V4C05 技能目录与五项 host 分派、模型任务 mode

[技能目录与五项 host 分派、模型任务 mode](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/service.ts)

固定提交 722-726;1328-1367；2026-10-29 本地源码核验。

## V4C06 任务实际依赖和模型版本指纹

[任务实际依赖和模型版本指纹](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runner.ts)

固定提交 277-297;903-905;943-959；2026-10-29 本地源码核验。

## V4C07 工具 JSON schema 校验、幂等与未知结果

[工具 JSON schema 校验、幂等与未知结果](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/tool-gateway.ts)

固定提交 14-44;59-66；2026-10-29 本地源码核验。

## V4C08 操作去重和未知结果

[操作去重和未知结果](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/operations.ts)

固定提交 23-46；2026-10-29 本地源码核验。

## V4C09 正式提交由宿主完成并绑定批准内容

[正式提交由宿主完成并绑定批准内容](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/commit-kernel.ts)

固定提交 7-27；2026-10-29 本地源码核验。

## V4C10 讨论工具、全树 rulesHash、任务卡依赖

[讨论工具、全树 rulesHash、任务卡依赖](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/conversation-runner.ts)

固定提交 64-123;142-156;166-240；2026-10-29 本地源码核验。

## V4C11 旧阶段 Markdown 输出与原模板硬门槛

[旧阶段 Markdown 输出与原模板硬门槛](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/skill-output-contract.ts)

固定提交 44-97；2026-10-29 本地源码核验。

## V4C12 阶段输出和累计 requiredInputs

[阶段输出和累计 requiredInputs](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/domain.ts)

固定提交 89-121；2026-10-29 本地源码核验。

## V4C13 共享前缀、来源去重与 user 数据边界

[共享前缀、来源去重与 user 数据边界](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/prompt-cache.ts)

固定提交 4-62；2026-10-29 本地源码核验。

## V4C14 创意/命名资源的独立锁与版本分支

[创意/命名资源的独立锁与版本分支](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/creation-prompts.ts)

固定提交 20-58;144-178；2026-10-29 本地源码核验。

## V4C15 章后 memory 完整台账 required 注入

[章后 memory 完整台账 required 注入](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runner.ts)

固定提交 1149-1171；2026-10-29 本地源码核验。

## V4C16 现有 prompt 模式与模板兼容测试

[现有 prompt 模式与模板兼容测试](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/creation-prompts.test.ts)

固定提交 240-266；2026-10-29 本地源码核验。

## V4C17 完整的 26 项技能目录

[完整的 26 项技能目录](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/resources/skill/runtime/skills.registry.json)

固定提交 1-529；2026-10-29 本地源码核验。

## V4C18 契约说明字段与实际工具权限

[契约说明字段与实际工具权限](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/resources/skill/runtime/skills/webnovel-chapter-drafter/contract.json)

固定提交 1-31；2026-10-29 本地源码核验。

## V4C19 skills.list / skill.run IPC schema

[skills.list / skill.run IPC schema](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/shared/contracts.ts)

固定提交 147-149；2026-10-29 本地源码核验。

## V4N01 InkOS 当前项目与技能边界

[InkOS 当前项目与技能边界](https://github.com/Narcooo/inkos)

核验提交 53adac4e974b54dafda975edc4edd07cad364c18；2026-10-24 提交，2026-10-29 读取。

## V4N02 Webnovel Writer 分支说明

[Webnovel Writer 分支说明](https://github.com/lingfengQAQ/webnovel-writer)

master 为 v6，v8 为独立工作台产品线；2026-10-29 核验。

## V4N03 Oh Story 分层改稿技能

[Oh Story 分层改稿技能](https://github.com/zenstory-ai/oh-story-claudecode/blob/70d1cf426f8cbe3d374e2b06e4c2cbdbd986da06/skills/story-deslop/SKILL.md)

表达、叙事用笔和故事因果；固定提交源码读取。

## V4N04 Webnovel Writer 8.3.2 README

[Webnovel Writer 8.3.2 README](https://github.com/lingfengQAQ/webnovel-writer/blob/dbba2e471bde3ba4997edee31319977194861cae/README.md)

v8 固定提交；作品工件、章节闭环、可选检索；2026-10-29 读取。

## V4N05 InkOS 创作宿主契约

[InkOS 创作宿主契约](https://github.com/Narcooo/inkos/blob/53adac4e974b54dafda975edc4edd07cad364c18/skills/SKILL.md)

技能方法与 action 权限分开；不照搬其语义检索模型调用。

## V4N06 Oh Story 0.9.1 提交

[Oh Story 0.9.1 提交](https://github.com/zenstory-ai/oh-story-claudecode/commit/70d1cf426f8cbe3d374e2b06e4c2cbdbd986da06)

2026-10-26 提交；2026-10-29 核验。

## V4N07 星月书台当前 main

[星月书台当前 main](https://api.github.com/repos/965896829/xingyue-shutai/branches/main)

2026-10-29 重新核验 main 为 b505f6f459db74871f39f63acf6106b827c8a353。

## V4N08 星月书台版本与 Pi 依赖

[星月书台版本与 Pi 依赖](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/package.json)

0.4.82；pi-agent-core 与 pi-ai 均为 1.4.0；2026-10-29 远端与本地读取一致。

## V5F01 番茄标签讲解（阅读标签前身）

[番茄标签讲解（阅读标签前身）](https://fanqienovel.com/writer/zone/article/7617805652965982232)

2026-03-16；公开HTML内嵌_ROUTER_DATA正文核验主分类、主题、角色、情节及数量规则。

## V5F02 番茄原创网文标签体系升级公告

[番茄原创网文标签体系升级公告](https://fanqienovel.com/writer/zone/article/7677414599091552318)

2026-08-24；公开HTML正文核验阅读标签与独立内容标签、读者可见性、具体选择规则以作品页为准。

## V5F03 番茄公开书库入口

[番茄公开书库入口](https://fanqienovel.com/library)

2026-10-29普通HTML读取，SSR没有分类；页面引用Library.0b55a2e7.js及主脚本。

## V5F04 书库公开前端分类调用

[书库公开前端分类调用](https://lf-fe.fqnovelstatic.com/obj/novel-fanqie-fe/toutiao/muye/Library.0b55a2e7.js)

公开页面引用的静态JS；只读解析看到CATEGORY_LIST与gender参数，不执行脚本。

## V5F05 书库公开前端路径常量

[书库公开前端路径常量](https://lf-fe.fqnovelstatic.com/obj/novel-fanqie-fe/toutiao/muye/js/muye_dab5cb12.js)

公开脚本将CATEGORY_LIST映射到/api/author/book/category_list/v0/；观察到的前端依赖，非稳定API承诺。

## V5F06 公开书库男频分类返回

[公开书库男频分类返回](https://fanqienovel.com/api/author/book/category_list/v0/?gender=1)

2026-10-29无登录普通GET，HTTP200 code0，154项；19主分类、33主题、22角色、80情节。

## V5F07 公开书库女频分类返回

[公开书库女频分类返回](https://fanqienovel.com/api/author/book/category_list/v0/?gender=0)

2026-10-29无登录普通GET，HTTP200 code0，182项；21主分类、25主题、41角色、95情节。

## V5F08 番茄公开排行榜目录与说明

[番茄公开排行榜目录与说明](https://fanqienovel.com/rank)

2026-10-29公开HTML内嵌目录男19女18，37频道入口、34去重ID；不等于作者完整分类。

## V5F09 玄幻脑洞新书榜

[玄幻脑洞新书榜](https://fanqienovel.com/rank/1_1_257)

统计截止10-28 24:00；观察前两名并用官方详情页核验书名。

## V5F10 东方仙侠新书榜

[东方仙侠新书榜](https://fanqienovel.com/rank/1_1_1140)

2026-10-29普通HTML读取，前两名作为标题形态样本。

## V5F11 都市日常阅读榜

[都市日常阅读榜](https://fanqienovel.com/rank/1_2_261)

2026-10-29普通HTML读取，前两名作为标题形态样本。

## V5F12 悬疑脑洞阅读榜

[悬疑脑洞阅读榜](https://fanqienovel.com/rank/1_2_539)

统计截止10-28 24:00；含长卖点标题与短标题，不能统一为长标题规则。

## V5F13 豪门总裁阅读榜

[豪门总裁阅读榜](https://fanqienovel.com/rank/0_2_748)

统计截止10-28 24:00；含氛围短标题与直接情节标题。

## V5F14 全班同学穿越，我开局拜菩提祖师

[全班同学穿越，我开局拜菩提祖师](https://fanqienovel.com/page/7693170346114944062)

官方作品详情HTML标题核验，榜单身份由title-evidence中的boardId和bookId关联。

## V5F15 天渊镇守百万载，你要挖我族人骨

[天渊镇守百万载，你要挖我族人骨](https://fanqienovel.com/page/7689506725073783833)

官方作品详情HTML标题核验，榜单身份由title-evidence中的boardId和bookId关联。

## V5F16 西游：开局找黄狮精买功法

[西游：开局找黄狮精买功法](https://fanqienovel.com/page/7687124176171174974)

官方作品详情HTML标题核验，榜单身份由title-evidence中的boardId和bookId关联。

## V5F17 洪荒：开局带着白莲绿茶拜师三清

[洪荒：开局带着白莲绿茶拜师三清](https://fanqienovel.com/page/7686053177874975768)

官方作品详情HTML标题核验，榜单身份由title-evidence中的boardId和bookId关联。

## V5F18 都重生了，谁还装富二代啊

[都重生了，谁还装富二代啊](https://fanqienovel.com/page/7630067790849788953)

官方作品详情HTML标题核验，榜单身份由title-evidence中的boardId和bookId关联。

## V5F19 公安局长之扫黑风暴

[公安局长之扫黑风暴](https://fanqienovel.com/page/7646327973087300670)

官方作品详情HTML标题核验，榜单身份由title-evidence中的boardId和bookId关联。

## V5F20 骇夜：我在恐怖游戏里暴富

[骇夜：我在恐怖游戏里暴富](https://fanqienovel.com/page/7617740782291651646)

官方作品详情HTML标题核验，榜单身份由title-evidence中的boardId和bookId关联。

## V5F21 十日终焉

[十日终焉](https://fanqienovel.com/page/7143038691944959011)

官方作品详情HTML标题核验，榜单身份由title-evidence中的boardId和bookId关联。

## V5F22 温夜潮湿

[温夜潮湿](https://fanqienovel.com/page/7654742513151921177)

官方作品详情HTML标题核验，榜单身份由title-evidence中的boardId和bookId关联。

## V5F23 惊！阴鸷太子爷的炮灰老婆重生了

[惊！阴鸷太子爷的炮灰老婆重生了](https://fanqienovel.com/page/7661066068244302873)

官方作品详情HTML标题核验，榜单身份由title-evidence中的boardId和bookId关联。

## V5C01 现有桌面技术栈与依赖

[现有桌面技术栈与依赖](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/package.json)

完整文件；Electron/React/Vite/TypeScript/Pi版本及直接依赖；2026-10-29 核验。

## V5C02 用户快照标签库与范围

[用户快照标签库与范围](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/resources/skill/tags/registry/taxonomy.json)

1–95；482项、8组、19主分类、来源未独立实时核验；2026-10-29 核验。

## V5C03 平台规则与未知边界

[平台规则与未知边界](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/resources/skill/tags/registry/platform-policy.json)

完整文件；阅读标签、内容标签、可用性、组合分开；2026-10-29 核验。

## V5C04 标签规则来源记录

[标签规则来源记录](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/resources/skill/tags/sources.json)

完整文件；用户快照和两项官方公告；2026-10-29 核验。

## V5C05 19项题材创作策略草案

[19项题材创作策略草案](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/resources/skill/tags/registry/genre-profiles.json)

完整文件；编辑建议并非平台定义；2026-10-29 核验。

## V5C06 标签与创意合同

[标签与创意合同](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/shared/tags.ts)

7–19,31–92,106–156；固定8组与限额、三案合同；2026-10-29 核验。

## V5C07 标签加载与编译

[标签加载与编译](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/tags.ts)

50–186；资源锁、校验、自由创意与按需知识；2026-10-29 核验。

## V5C08 标签选择与范围说明

[标签选择与范围说明](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/TagWorkspace.tsx)

33–205；主分类、分组搜索、上限、来源说明；2026-10-29 核验。

## V5C09 新建作品与已有设定入口

[新建作品与已有设定入口](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/App.tsx)

1817–1923；默认创意、可选标签、已有设定、可选额外评分；2026-10-29 核验。

## V5C10 现有世界设计方法

[现有世界设计方法](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/resources/skill/runtime/skills/webnovel-world-engine/SKILL.md)

23–32；作者设定、四层知情、条件能力、重复使用与代价；2026-10-29 核验。

## V5C11 世界模板必填字段

[世界模板必填字段](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/domain.ts)

51,86；固定八栏目及世界文件路径；2026-10-29 核验。

## V5C12 世界模板生成与指令

[世界模板生成与指令](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/skill.ts)

61,115；所有项目生成并要求八栏目；2026-10-29 核验。

## V5C13 阶段输出结构硬要求

[阶段输出结构硬要求](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/skill-output-contract.ts)

47–73；S03八栏目输出与字段限制；2026-10-29 核验。

## V5C14 世界栏目实际验证

[世界栏目实际验证](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/validation.ts)

35–55；缺失/空字段阻断及checkWorldFields；2026-10-29 核验。

## V5C15 作品方案与书名合同

[作品方案与书名合同](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/shared/creation.ts)

6–57,60–156；plan条目、承诺、标题、规则、版本；2026-10-29 核验。

## V5C16 命名的来源、验证与采纳

[命名的来源、验证与采纳](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/title-naming.ts)

43–193,200–245；方案绑定、冻结、去重、回执、审核；2026-10-29 核验。

## V5C17 现有番茄书名联网研究

[现有番茄书名联网研究](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/title-market-research.ts)

19–81,84–186；公开词、官方书页、同批复用、降级与非榜单声明；2026-10-29 核验。

## V5C18 书名研究记录与风格样本

[书名研究记录与风格样本](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/shared/title-style.ts)

1–34；时间来源、样本和分析结构，暂无rank字段；2026-10-29 核验。

## V5C19 官方书页和目录读取

[官方书页和目录读取](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/fanqie-catalogue.ts)

5–76；规范化URL、有界公开GET、分类简介和目录来源hash；2026-10-29 核验。

## V5C20 已有角色卡、有向图和故事视图

[已有角色卡、有向图和故事视图](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/ManuscriptInspector.tsx)

9–94；固定提交远端补读，含12边直接关系图和双时间标签；2026-10-29 核验。

## V5C21 已有记忆视角、分页、来源和修订UI

[已有记忆视角、分页、来源和修订UI](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/MemoryStudio.tsx)

完整文件；固定提交远端补读；2026-10-29 核验。

## V5C22 Markdown与事实的只读投影

[Markdown与事实的只读投影](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/manuscript-view.ts)

19–145；解析、ID、草稿叠加、来源过滤，当前Markdown权威；2026-10-29 核验。

## V5C23 投影视图数据合同

[投影视图数据合同](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/shared/manuscript-view.ts)

1–15；字段、角色、关系类别和来源；2026-10-29 核验。

## V5C24 投影缓存与更新时机

[投影缓存与更新时机](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/useManuscriptView.ts)

7–25；固定提交远端补读，不逐token重建；2026-10-29 核验。

## V5C25 同响应实时节点协议

[同响应实时节点协议](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/shared/narrative-events.ts)

15–104；UTF-16、可选sideband、锚点、坏数据不重试正文；2026-10-29 核验。

## V5C26 有来源曲线保存与查询

[有来源曲线保存与查询](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/narrative-curves.ts)

23–133；正文hash、五维、计划/候选/正式分层；2026-10-29 核验。

## V5C27 现有曲线入口与范围切换

[现有曲线入口与范围切换](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/NarrativePanel.tsx)

22–65；固定提交远端补读，本章/走势/维度与批次/全书；2026-10-29 核验。

## V5C28 实时节点与正文定位

[实时节点与正文定位](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/NarrativePlayback.tsx)

12–91；固定提交远端补读，已显示前缀门槛和来源；2026-10-29 核验。

## V5C29 已有五维对照

[已有五维对照](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/NarrativeComparison.tsx)

8–27；固定提交远端补读，复用已存判断，缺项留空；2026-10-29 核验。

## V5C30 UI流与节点更新隔离

[UI流与节点更新隔离](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/useLiveStream.ts)

14–20,47–87；动画帧合并、session/epoch/version/seq过滤；2026-10-29 核验。

## V5C31 实时节点版本保护

[实时节点版本保护](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/shared/live-narrative.ts)

4–49；重写清除旧节点、旧epoch/transport过滤；2026-10-29 核验。

## V5C32 创意标签与命名工作流测试源码

[创意标签与命名工作流测试源码](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/tags.test.ts)

50–164,498–624,741–1112,1333–1355,1811–1898；本轮未执行；2026-10-29 核验。

## V5C33 书名研究测试源码

[书名研究测试源码](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/title-market-research.test.ts)

16–150；固定提交远端补读，本轮未执行；2026-10-29 核验。

## V5C34 投影与草稿测试源码

[投影与草稿测试源码](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/manuscript-studio.test.ts)

28–141；固定提交远端补读，本轮未执行；2026-10-29 核验。

## V5C35 曲线来源与缺值测试源码

[曲线来源与缺值测试源码](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/narrative-curves.test.ts)

19–138；固定提交远端补读，本轮未执行；2026-10-29 核验。

## V5C36 同请求节点与恢复测试源码

[同请求节点与恢复测试源码](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/narrative-events.test.ts)

23–195；固定提交远端补读，本轮未执行；2026-10-29 核验。

## V5C37 现有实时书名证据展示

[现有实时书名证据展示](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/TitleMarketEvidence.tsx)

3–20；固定提交远端补读，来源/时间/brief；2026-10-29 核验。

## V5C38 现有书名选择工作区

[现有书名选择工作区](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/ui/TitleWorkspace.tsx)

完整文件；固定提交远端补读，显示研究记录及离线样本；2026-10-29 核验。

## V5V01 星月书台 package.json：Electron/React/Pi 栈

[星月书台 package.json：Electron/React/Pi 栈](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/package.json)

2026-10-29 本地固定提交读取；Electron 44.6.0，React 19.3.0，TypeScript 5.9.3，Vite 8.3.3，React Query 5.103.1，Pi 1.4.0；未安装图谱库。

## V5V02 React Flow 12.12.0 发布

[React Flow 12.12.0 发布](https://github.com/xyflow/xyflow/releases/tag/%40xyflow/react%4012.12.0)

官方 GitHub releases API 核验：2026-09-24T12:39:56Z；monorepo latest 指向 Svelte，已单独过滤 React 包发布。

## V5V03 React Flow 12.12.0 包与 React peerDependencies

[React Flow 12.12.0 包与 React peerDependencies](https://github.com/xyflow/xyflow/blob/%40xyflow/react%4012.12.0/packages/react/package.json)

MIT；React/ReactDOM peerDependencies >=17，声明范围覆盖项目 React 19；尚未做安装后集成测试。

## V5V04 React Flow 性能指引

[React Flow 性能指引](https://reactflow.dev/learn/advanced-use/performance)

memoization、独立选择状态、折叠大树、简化节点边；2026-10-29 读取。

## V5V05 React Flow 无障碍交互

[React Flow 无障碍交互](https://reactflow.dev/learn/advanced-use/accessibility)

键盘导航、节点移动、可本地化 ariaLabelConfig；2026-10-29 读取。

## V5V06 React Flow 禁止特定连接形成环的示例

[React Flow 禁止特定连接形成环的示例](https://reactflow.dev/examples/interaction/prevent-cycles)

连接验证示例；仅依赖/先决关系需要 DAG，普通人物关系不能统一禁环。

## V5V07 Apache ECharts 6.1.0 发布

[Apache ECharts 6.1.0 发布](https://github.com/apache/echarts/releases/tag/6.1.0)

官方 GitHub releases API 核验：2026-05-19T17:38:29Z。

## V5V08 Apache ECharts LICENSE

[Apache ECharts LICENSE](https://github.com/apache/echarts/blob/master/LICENSE)

2026-10-29 读取实际 LICENSE：Apache License 2.0。

## V5V09 Apache ECharts 动态数据

[Apache ECharts 动态数据](https://echarts.apache.org/handbook/en/how-to/data/dynamic-data/)

setOption 驱动动态更新；图表更新不代表应用事务与数据来源已实现。

## V5V10 Apache ECharts 事件与交互

[Apache ECharts 事件与交互](https://echarts.apache.org/handbook/en/concepts/event/)

click、datazoom、legendselectchanged 等事件；用于联动选章、聚焦与过滤。

## V5V11 Apache ECharts 数据集分离

[Apache ECharts 数据集分离](https://echarts.apache.org/handbook/en/concepts/dataset/)

数据与展示配置分离；不是所有特殊图类型都使用同一种表格 dataset。

## V5V12 Cytoscape.js v3.34.4 发布

[Cytoscape.js v3.34.4 发布](https://github.com/cytoscape/cytoscape.js/releases/tag/v3.34.4)

官方 GitHub releases API 核验：2026-10-15T19:12:35Z。

## V5V13 Cytoscape.js 图查询与性能

[Cytoscape.js 图查询与性能](https://js.cytoscape.org/)

MIT 核心；JSON 序列化、图算法、headless 与视图分离；批量更新、样式与标签成本需控制。

## V5V14 Cytoscape.js LICENSE

[Cytoscape.js LICENSE](https://github.com/cytoscape/cytoscape.js/blob/master/LICENSE)

2026-10-29 读取实际 MIT 许可文本。

## V5V15 AntV G6 5.1.1 发布

[AntV G6 5.1.1 发布](https://github.com/antvis/G6/releases/tag/5.1.1)

官方 GitHub releases API 核验：2026-04-17T03:19:19Z。

## V5V16 AntV G6 5.x 渲染器

[AntV G6 5.x 渲染器](https://g6.antv.antgroup.com/en/manual/further-reading/renderer)

默认 Canvas，可采用 SVG/WebGL；渲染器支持不等于已验证百万字作品性能。

## V5V17 AntV G6 5.0 迁移说明

[AntV G6 5.0 迁移说明](https://g6.antv.antgroup.com/en/manual/whats-new/upgrade)

数据操作接口变化，5.x 移除内置 undo/redo；项目不能依靠图库撤销处理正文与正史。

## V5V18 AntV G6 LICENSE

[AntV G6 LICENSE](https://github.com/antvis/G6/blob/v5/LICENSE)

2026-10-29 读取实际 MIT 许可文本。

## V5V19 vis-timeline v8.5.6 发布

[vis-timeline v8.5.6 发布](https://github.com/visjs/vis-timeline/releases/tag/v8.5.6)

官方 GitHub releases API 核验：2026-10-26T17:20:12Z。

## V5V20 vis-timeline 文档

[vis-timeline 文档](https://visjs.github.io/vis-timeline/docs/timeline/)

点/区间、分组、缩放、编辑；自定义虚构历法仍需宿主时间模型与映射。

## V5V21 vis-timeline 实际双许可

[vis-timeline 实际双许可](https://github.com/visjs/vis-timeline/blob/v8.5.6/LICENSE.md)

Apache-2.0 OR MIT；已读取 LICENSE.md 与 LICENSE.MIT.txt。

## V5V22 Yjs v13.6.33 发布

[Yjs v13.6.33 发布](https://github.com/yjs/yjs/releases/tag/v13.6.33)

官方 GitHub releases API 核验：2026-09-23T16:37:33Z。

## V5V23 Yjs 协作编辑基础

[Yjs 协作编辑基础](https://docs.yjs.dev/getting-started/a-collaborative-editor)

共享数据、editor binding、provider；适用于多人同步，不自动实现小说语义冲突与采纳。

## V5V24 Yjs LICENSE

[Yjs LICENSE](https://github.com/yjs/yjs/blob/main/LICENSE)

2026-10-29 读取实际 MIT 许可文本。

## V5V25 Novalist 固定提交 README

[Novalist 固定提交 README](https://github.com/Drommedhar/novalist-official/blob/176673f36923db488b444e2ef2552d5611cb88fb/README.md)

2026-10-29核验；Electron/React前端与.NET 10 core；世界资料、场景、多个视图与扩展。

## V5V26 Novalist 自定义实体类型模型

[Novalist 自定义实体类型模型](https://github.com/Drommedhar/novalist-official/blob/176673f36923db488b444e2ef2552d5611cb88fb/Novalist.Core/Models/CustomEntityTypeDefinition.cs)

实际源码：自定义 typeKey、typed fields、default、enum、required、关系/分节开关。

## V5V27 Novalist 实体在故事位置上的状态覆盖

[Novalist 实体在故事位置上的状态覆盖](https://github.com/Drommedhar/novalist-official/blob/176673f36923db488b444e2ef2552d5611cb88fb/Novalist.Core/Models/EntityStateOverride.cs)

实际源码：act/chapter/scene、名称描述字段、gone；可借鉴场景时态实体展示，但不能代替 V3 的来源、编辑分支与获知时钟。

## V5V28 Novalist 状态解析器

[Novalist 状态解析器](https://github.com/Drommedhar/novalist-official/blob/176673f36923db488b444e2ef2552d5611cb88fb/Novalist.Core/Services/EntityStateResolver.cs)

实际源码：优先场景、章节、act的覆盖匹配；应用内重用应沿自身事件投影合同实现。

## V5V29 Novalist PlotLanes React 组件

[Novalist PlotLanes React 组件](https://github.com/Drommedhar/novalist-official/blob/176673f36923db488b444e2ef2552d5611cb88fb/app/src/renderer/src/views/plotgrid/PlotLanes.tsx)

实际源码：SVG情节线、共享场景节点和打开场景回调；适合参考表现逻辑。

## V5V30 Novalist PromisesPanel React 组件

[Novalist PromisesPanel React 组件](https://github.com/Drommedhar/novalist-official/blob/176673f36923db488b444e2ef2552d5611cb88fb/app/src/renderer/src/views/plotgrid/PromisesPanel.tsx)

实际源码：promise与payoff场景、未兑现/兑现/断裂/顺序状态，绑定其RPC与store；需适配 V3 证据与承诺状态。

## V5V31 Novalist LICENSE

[Novalist LICENSE](https://github.com/Drommedhar/novalist-official/blob/176673f36923db488b444e2ef2552d5611cb88fb/LICENSE)

2026-10-29 读取实际 LICENSE：MIT，Copyright 2026 Dominik。

## V5V32 StoryLine 固定提交 README

[StoryLine 固定提交 README](https://github.com/PixeroJan/obsidian-storyline/blob/6aa9800fddd7800d8af3e1fea0ce3023b58fff14/README.md)

2026-10-29核验；Obsidian插件，地铁式情节线、场景矩阵、关系图、来源反向引用等。

## V5V33 StoryLine 地铁情节线实现

[StoryLine 地铁情节线实现](https://github.com/PixeroJan/obsidian-storyline/blob/6aa9800fddd7800d8af3e1fea0ce3023b58fff14/views/StorylineView.ts)

实际源码：共享过滤、场景排序、SVG多情节线；依赖Obsidian ItemView，不是直接可安装到本应用的组件。

## V5V34 StoryLine 关系图实现与规模边界

[StoryLine 关系图实现与规模边界](https://github.com/PixeroJan/obsidian-storyline/blob/6aa9800fddd7800d8af3e1fea0ce3023b58fff14/components/RelationshipMap.ts)

实际源码：两两斥力 O(V²)、每帧重新生成SVG；注释针对少于100节点。适合交互灵感，不应照搬作为全书大图引擎。

## V5V35 StoryLine 实体-场景图实现

[StoryLine 实体-场景图实现](https://github.com/PixeroJan/obsidian-storyline/blob/6aa9800fddd7800d8af3e1fea0ce3023b58fff14/components/StoryGraph.ts)

实际源码：scene/entity/prop/character连边与类型过滤；通过wikilink和名字拼接身份，需替换为本应用稳定entityId及来源关系。

## V5V36 StoryLine LICENSE

[StoryLine LICENSE](https://github.com/PixeroJan/obsidian-storyline/blob/6aa9800fddd7800d8af3e1fea0ce3023b58fff14/LICENSE)

2026-10-29 读取实际 LICENSE：MIT，Copyright 2026 PixeroJan。

## V5V37 React Flow 布局概览

[React Flow 布局概览](https://reactflow.dev/learn/layouting/layouting)

官方明确未实现自有完整布局解法，列出独立布局依赖；2026-10-29读取。

## V5V38 React Flow Pro 范围

[React Flow Pro 范围](https://reactflow.dev/pro)

MIT 核心与 Pro 示例、模板及服务分开；本轮不采购服务或复制受限示例。

## V5W01 WorldBuilder 世界开关与作者锁定模板

[WorldBuilder 世界开关与作者锁定模板](https://github.com/gofastercloud/worldbuilder/blob/99cf2bd4e57b1b4e8fcbafd5d0f6ac18b0d0cf36/assets/templates/world_flags.yaml)

2026-10-29 读取固定提交：显式/推断开关、锁定、例外与区域差异；借鉴结构，不复制其默认事实和社会假定。

## V5W02 WorldBuilder 能力体系 schema

[WorldBuilder 能力体系 schema](https://github.com/gofastercloud/worldbuilder/blob/99cf2bd4e57b1b4e8fcbafd5d0f6ac18b0d0cf36/assets/templates/magic-systems/_schema.yaml)

2026-10-29 读取：来源、效果边界、成本、反制、可选等级和体系交互；本项目保留无境界与作者自定义路线。

## V5W03 WorldBuilder 图与引用验证源码

[WorldBuilder 图与引用验证源码](https://github.com/gofastercloud/worldbuilder/blob/99cf2bd4e57b1b4e8fcbafd5d0f6ac18b0d0cf36/scripts/graph.py)

读取实际代码中的悬空引用、指定关系的逆向检查和业务规则；其领域硬编码与自动修复不能直接用于本项目正史。

## V5W04 WorldBuilder 实际 LICENSE

[WorldBuilder 实际 LICENSE](https://github.com/gofastercloud/worldbuilder/blob/99cf2bd4e57b1b4e8fcbafd5d0f6ac18b0d0cf36/LICENSE)

本轮读取实际 Apache-2.0 许可；当前交付只记录方法和来源，没有移植第三方源码。

## V5W05 graphify-novel 固定提交技能

[graphify-novel 固定提交技能](https://github.com/Anshler/graphify-novel/blob/124c9abc473508e081a625e4d2a24b24071581a2/SKILL.md)

2026-10-29 读取；故事资料与派生关系图分层、候选审阅与跨章查询可作思路参考，不能替代 V3 四时间、来源和事务合同。

## V5W06 星月书台当前 main 核验

[星月书台当前 main 核验](https://api.github.com/repos/965896829/xingyue-shutai/branches/main)

2026-10-29 本轮再次读取 main，提交仍为 b505f6f459db74871f39f63acf6106b827c8a353。

## V6 创作质量与探索补充来源

[V6R01] [LitBench 创意写作评价研究](https://aclanthology.org/2026.eacl-long.362/)。EACL 2026；英语短故事偏好任务，模型评委与偏好标签的差距及在线人类验证；不外推中文连载收益。

[V6R02] [个人风格后编辑研究](https://aclanthology.org/2026.acl-long.2030/)。ACL 2026；81 人预注册个人风格研究；后编辑仍可能保留模型风格，非中文网文实验。

[V6R03] [LiteraryTaste 个人创作偏好](https://arxiv.org/abs/2511.09310)。2025-11-12；60 人每人比较 100 对短文本，实际选择与自述口味分开；未验证长篇生成效果。

[V6R04] [开放式任务推理时计算研究](https://arxiv.org/html/2608.18931v1)。2026-08-19 预印本；候选探索与选择分别评估，模型家族与自动评委范围有限，WritingBench 使用英文子集。

[V6R05] [Promptfoo 模型评委与校准](https://www.promptfoo.dev/docs/guides/llm-as-a-judge/)。2026-10-29 核验；人工标注样本、开发集和保留集校准，开发评测参考。

[V6R06] [Promptfoo 断言与指标](https://www.promptfoo.dev/docs/configuration/expected-outputs/)。2026-10-29 核验；确定性、模型评分与自定义检查接口；不代替文学偏好。

[V6R07] [Promptfoo 许可证](https://github.com/promptfoo/promptfoo/blob/main/LICENSE)。2026-10-29 核验根许可 MIT；实际引入范围和依赖另行固定版本。

[V6R08] [InkOS 原文证据审稿实现](https://github.com/Narcooo/inkos/blob/53adac4e974b54dafda975edc4edd07cad364c18/packages/core/src/agents/continuity.ts)。固定提交完整读取；允许空观察，原文行证据、修改前后版本与范围判断；AGPL-3.0 项目。

[V6R09] [InkOS 当前创作架构](https://github.com/Narcooo/inkos)。2026-10-29 核验；2.0 开发分支、定性审稿和隔离分支计划，README 各语言可能不同步。

[V6R10] [Oh Story 三层修订方法](https://github.com/zenstory-ai/oh-story-claudecode/blob/70d1cf426f8cbe3d374e2b06e4c2cbdbd986da06/skills/story-deslop/SKILL.md)。固定提交完整读取；故事依据、场景用笔与表达分层；选取方法，不照搬机械标点和表达门槛。

[V6R11] [Oh Story 项目与许可](https://github.com/zenstory-ai/oh-story-claudecode)。2026-10-29 核验；中文网文技能项目，MIT；不等于本产品已安装或已验证效果。

[V6R12] [Inky 试演与回放交互](https://github.com/inkle/inky/blob/3d46aa92bf1572797f35d338bf75e37bb047f2e3/README.md)。固定提交；编辑后保留选择并回到原进度，Electron，README 含完整 MIT 文本。

[V6R13] [番茄人物活人感课程](https://fanqienovel.com/writer/zone/article/7612544314719076376)。2026-03-02；人物经历、细节、成长与配角欲望的创作课程。

[V6R14] [番茄过渡章与修改课程](https://fanqienovel.com/writer/zone/article/7626655961792380953)。2026-04-09；过渡章、自然转折、读完率与跳章反馈的修改讨论。

## V7 当前架构与执行边界补充来源

[V7C01] [Electron 写作内核启动与恢复](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/electron/main.ts)。0.4.82 固定提交源码审计。utilityProcess 独立内核、workerGeneration、projectSessionId 和监督恢复。

[V7C02] [独立内核中的应用服务](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/electron/worker.ts)。0.4.82 固定提交源码审计。Service 实际在 worker 持有；命令、协议与代次校验。

[V7C03] [Pi 回合与宿主边界](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/task-loop.ts)。0.4.82 固定提交源码审计。宿主持有规范请求和回执；顺序工具、maxRetries 为 0，执行器不建立第二套状态。

[V7C04] [应用命令与共创入口](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/service.ts)。0.4.82 固定提交源码审计。作品、任务、讨论、候选修改、采纳及阶段协调；现有讨论并非缺失。

[V7C05] [业务执行与实时评估](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runner.ts)。0.4.82 固定提交源码审计。流程分发、上下文、审稿与记忆转移；正文前后存在模型评估等待。

[V7C06] [旧技能注册与装配](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/skill-registry.ts)。0.4.82 固定提交源码审计。固定 26 技能、阶段映射、资源哈希和候选权限；不能直接改成目标 19 包。

[V7C07] [正式事务与事实更新](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/storage.ts)。0.4.82 固定提交源码审计。SQLite 权威、对象、CAS、outbox；applyJournal 807 至 825 行全量解析台账与 replaceFacts。

[V7C08] [记忆检索与人物状态](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/memory-studio.ts)。0.4.82 固定提交源码审计。视角、时域、来源校验已存在；retrieveMemory 和 characterState 仍有全事实筛选路径。

[V7C09] [当前事实与证据合同](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/shared/types.ts)。0.4.82 固定提交源码审计。事件、规则、计划、信念、推断、知情边界和证据版本。

[V7C10] [上下文编译与预算](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/context-compiler.ts)。0.4.82 固定提交源码审计。当前快照、资料分层、来源、强制约束与预算；未来初读和人物回合需要专用完整请求策略。

[V7C11] [已有增量快照](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/snapshot-codec.ts)。0.4.82 固定提交源码审计。delta-v1 文档与事实差异，深度上限及来源校验；保留现有机制。

[V7C12] [工具网关与副作用](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/tool-gateway.ts)。0.4.82 固定提交源码审计。白名单、schema、工具回执；当前效果按工具命名前缀分类，未来改显式契约。

[V7C13] [模型请求预算与恢复](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/model-gateway.ts)。0.4.82 固定提交源码审计。发送意图、费用预留、结果持久化和 unknown；宿主统一恢复。

[V7C14] [阶段输入和产物依赖](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/domain.ts)。0.4.82 固定提交源码审计。S01 至 S11、stageOutputs、requiredInputs，适合保留为引导并逐步转换为任务依赖。

[V7C15] [硬终止恢复测试](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/refactor-crash.test.ts)。0.4.82 固定提交源码审计。子进程 SIGKILL、提交边界与未知请求恢复；本轮阅读测试设计，没有执行。

[V7C16] [现有合成规模测试](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/tests/scale.ts)。0.4.82 固定提交源码审计。1200 章、300 万字，一次提交、扫描与编号检索；不代表真实连续创作质量。

[V7C17] [现有操作幂等回执](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/operations.ts)。0.4.82 固定提交源码审计。UI 操作编号和输入绑定；与能力操作注册表职责不同。

[V7C18] [正式采纳内核](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/commit-kernel.ts)。0.4.82 固定提交源码审计。审批绑定候选、基础快照和范围，重复采纳复用已有正式事务。

[V7C19] [资源调度器](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/scheduler.ts)。0.4.82 固定提交源码审计。资源互斥与独立工作调度；保留单一正式提交序列。

[V7C20] [执行记录及恢复版本](https://github.com/965896829/xingyue-shutai/blob/b505f6f459db74871f39f63acf6106b827c8a353/src/core/runtime/execution-records.ts)。0.4.82 固定提交源码审计。执行生命周期与版本竞争；终结记录不能直接重新运行。

[V7R01] [Pi agent core 官方文档](https://github.com/earendil-works/pi/blob/main/packages/agent/README.md)。2026-10-29 核验官方上游；工具执行、状态和事件流。上游 main 不等同于项目已安装版本全部行为。

[V7R02] [LangGraph TypeScript 持久化](https://docs.langchain.com/oss/javascript/langgraph/persistence)。2026-10-29 核验；线程检查点与跨线程 Store 分开，小说领域语义仍由应用定义。

[V7R03] [LangGraph TypeScript 中断恢复](https://docs.langchain.com/oss/javascript/langgraph/interrupts)。2026-10-29 核验；恢复时重新进入节点，副作用需要幂等与重放治理。

[V7R04] [Temporal 生产部署](https://docs.temporal.io/production-deployment)。2026-10-29 核验；生产 Service 与 Worker，可云托管或自建，也有本地开发服务器。

[V7R05] [Temporal Agent 记忆与状态](https://docs.temporal.io/ai/featured/memory-state-stripe)。官方页面标注 2026-10-06 验证故障示例；区分上下文、长期记忆、执行与外部效果状态，不代表本产品测试。

[V7R06] [Anthropic 稳定接口与执行解耦](https://www.anthropic.com/research/managed-agents)。2026-04-08 工程文章，2026-10-29 核验；持久会话、harness 和工具边界，session 与 context window 分开。
