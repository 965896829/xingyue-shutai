# V3 研究与工程选型

## 3 前沿研究与 GitHub 选型

本轮选择参考机制时，分别核验了论文、官方代码和实际部署成本。对本地创作客户端，先采用适合现有数据模型的机制；完整第三方服务可保留为后续适配选项。

| 参考 | 可借鉴内容 | 在本项目中的定位 |
| --- | --- | --- |
| Graphiti | 事实有效时间、入库时间、历史与来源 | 版本化事件和状态设计的工程参考 |
| Hindsight | 多路召回、预算裁剪、后台预计算 | 检索与常用状态投影的参考 |
| MAGMA | 语义、时间、因果、实体的不同关系视图 | 同一套数据上的多种检索入口 |
| HELM | 来源、认识状态、失效与证据治理 | 检索资格和摘要来源的研究参考 |
| Narrative World Model | 知情、揭示顺序、承诺与叙事状态 | 面向小说的最新记忆研究参考 |
| Generative Agents 与 Concordia | 经历、观察、反思、行动和结果分离 | 人物动态状态的组件边界参考 |
| REMP 与 ConStory Bench | 长程人物连续性和故事一致性 | 原创评测集的维度参考 [CM05][NR02] |

Graphiti 官方版本记录显示 2026 年 10 月仍在维护；完整接入需要 Python 与图后端。Hindsight 开源实现使用 PostgreSQL 体系，并提供 TypeScript 客户端。两者可以借鉴，但现阶段不必为了保存一部百万字作品同时增加多个后台服务。[MR01][MR02][MR21][MR22]

MAGMA 把同一记忆组织为不同关系视图；HELM 关注语义相关但已经过时或依据不足的记忆。V3 采用的工程判断是：先用版本、时间、来源和使用范围决定能否使用，再用检索排序决定先看什么。[MR09][MR11]

2026 年 7 月的 Narrative World Model 直接研究小说记忆，把人物知情、事件与揭示顺序、承诺和状态放入检索结构。论文评测的是证据支持的故事问答，生成与作者工作流仍列为后续研究；本轮将其作为结构设计参考，未核验到可直接接入的官方成熟软件包。[NR01]

Hindsight 的 Mental Model 是长期问题答案的预计算，不等于虚构人物心理；其 recall 也不会仅因询问者不同自动过滤人物未知信息。Mem0 最新平台成绩包含开源 SDK 没有的优化，平台共现图也不能直接替代有类型的人物关系。选型表中的性能与功能都保留各自适用范围。[MR03][MR04][MR05][MR06][MR07]

## 参考

[MR01] [Graphiti official repository](https://github.com/getzep/graphiti)

[MR02] [Graphiti releases](https://github.com/getzep/graphiti/releases)

[MR03] [Hindsight architecture overview](https://hindsight.vectorize.io/)

[MR04] [Hindsight mental models](https://hindsight.vectorize.io/developer/mental-models)

[MR05] [Introducing Hindsight Memlake](https://hindsight.vectorize.io/blog/2026/10/13/memlake)

[MR06] [Mem0 official repository and April 2026 algorithm](https://github.com/mem0ai/mem0)

[MR07] [Mem0 current platform graph-memory documentation](https://github.com/mem0ai/mem0/blob/main/docs/platform/features/graph-memory.mdx)

[MR09] [MAGMA: A Multi-Graph based Agentic Memory Architecture for AI Agents](https://aclanthology.org/2026.acl-long.1709/)

[MR11] [HELM: Steering Long-Horizon Agents with Learned Hierarchical Memory and Epistemic Governance](https://aclanthology.org/2026.emnlp-main.721/)

[MR21] [Hindsight official repository](https://github.com/vectorize-io/hindsight)

[MR22] [Hindsight release history](https://github.com/vectorize-io/hindsight/releases)

[NR01] [Narrative World Model](https://arxiv.org/html/2607.05577v1)

[CM05] [REMP: A Structured Event-Probing Benchmark for Long-Horizon Role-Playing Dialogue](https://aclanthology.org/2026.findings-emnlp.602/)

[NR02] [ConStory Bench 官方仓库](https://github.com/Picrew/ConStory-Bench)
