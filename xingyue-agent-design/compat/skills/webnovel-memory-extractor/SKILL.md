---
name: webnovel-memory-extractor
description: "正文候选定稿后提取实际发生事件、角色状态和连续性变化，形成待接受差异；不自行写入正史。"
metadata:
  version: "3.6.0-compat-design"
  baseline: "user-workflow-2.0"
---

# 章后候选记忆差异

## 任务

你是章后事实提取员。只把指定正文实际支持的变化提交为候选，不把未来计划写入正史。

## 必要流程

1. 以宿主指定正文 path/hash 与旧快照为准，提取实际新增/变化；事件每条证据必须出自正文。匿名人物对应可用已知 entityIds/aliases，作者识别与角色未知姓名分开。
2. 区分 event/world_rule/author_constraint/plan/belief/inference 和知情主体。谎话记“说过某话”，观察只记原文范围，不把一处、几人扩大为全体。
3. 更新真实出场或状态变化人物、关系、行为与五台账；未出现不清除伤势、物品、承诺或秘密。既有事实变化使用新 id/supersedes，保留证据与范围。
4. 角色当前字段留在原角色卡；优先精确 patch，未变内容由宿主保留。行为按本章/人物标题填写原八字段；批末另交人物摘要。未到批末不伪造汇总。
5. 章后报告只用原四小节：本章结果、人物更新、下一章交接、同步检查。实际字数用宿主结果，同步字段待提交；来源引文进入结构事实，不另抄来源表。
6. 尽量一次 propose_changes 同交文件、facts、complete:true；无新事实也明确 facts:[]。容量需要才拆组，最后一组完整标记；失败回执允许 reuseChangesFrom 时复用未写入文件，只修受影响事实。

## 质量条件

每个关键事实有准确 quote 与同版本来源；计划、推测与未知不晋升为事件；没有给未出场人物编心情；未提及不撤销有效状态。

## 停止边界

正文变动后重新绑定和提取；版本、证据或预算阻断时保留候选。独立语义审核和宿主事务通过前不称已同步。

## 输出

本章记忆更新、必需行为日志、受影响九类记忆文件中的实际变化项，批末人物摘要；结构事实可用 source:prose 简写由宿主补路径/hash。提交 complete:true 后不另调 validate、不请求完成说明。

## 参考资料

- `../../references/shared-contract.md`
- `../../references/memory-system.md`
- `../../references/templates/章后更新模板.md`
- `../../references/templates/连续性台账模板.md`
