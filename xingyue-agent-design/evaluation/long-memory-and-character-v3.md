# 长篇记忆与人物验收 V3

## 18 记忆与人物验收

验收分成结构、检索、人物和文学四组，分别报告结果。BEAM、LongMemEval、MINTEval 可提供更新、时间、多段推理和干扰维度；ConStory Bench 提供人物、细节、风格、时间剧情和世界一致性维度。它们不直接等同中文长篇创作效果。[MR16][MR18][NR02][NR03][NR04]

| 验收项 | 样例或判断方式 |
| --- | --- |
| 久远关键记忆 | 第 1 章物件在第 300 章被不同措辞问到，返回原依据 |
| 正常历史演变 | 受伤后痊愈，回看早章仍能查到当时伤势 |
| 编辑修订 | 同一章节旧版与新版分别回答，不交叉引用 |
| 角色认知 | 谣言、误信、真相和知情先后分开 |
| 章内变化 | 同章先误解后纠正，各场景状态正确 |
| 倒叙与回忆 | 旧情绪不覆盖当前状态，回忆引发的现实情绪另有事件 |
| 人物覆盖 | 正文名单中的每个角色都有审视结果 |
| 情绪连续性 | 有触发、有依据、有后续作用；空缺不编造 |
| 人格稳定与成长 | 短时情绪不覆盖内核，重大选择能够形成演化 |
| 修订影响 | 具体读集和空查询依赖均能失效，无关内容可保持 |
| 运行恢复 | 幂等提交、崩溃恢复、旧 hash 结果拒绝、索引降级 |
| 文学表现 | 同场景与连续章节盲比，评估人物辨识、动机和自然表达 |

结构回归集对串分支、未来泄漏、无源事实和重复提交采用零容忍断言。开放文本抽取另测精确率、漏提率和身份解析质量。检索报告必需证据覆盖、来源定位、旧版本误用、实际 token 和本地 P50/P95；不能把这些压成一个高分。

建议在相同作品、模型、温度和预算下比较现行方案、索引与投影方案、加入人物信念方案、再加入语义与因果扩展方案。长篇回归覆盖 100 万、300 万和更大规模，并改变事实密度、活跃人物数与版本链长度。具体性能目标在目标设备上建立基线后确定。

## 参考

[MR16] [Beyond a Million Tokens: Benchmarking and Enhancing Long-Term Memory in LLMs](https://proceedings.iclr.cc/paper_files/paper/2026/hash/d7f0cfa0fe759b033d5262e1bb7d4065-Abstract-Conference.html)

[MR18] [LongMemEval official repository](https://github.com/xiaowu0162/longmemeval)

[NR02] [ConStory Bench 官方仓库](https://github.com/Picrew/ConStory-Bench)

[NR03] [MINTEval](https://arxiv.org/abs/2605.18565)

[NR04] [LongMemEval V2](https://xiaowu0162.github.io/longmemeval-v2/)
