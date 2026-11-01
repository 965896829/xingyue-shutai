---
name: webnovel-memory-extractor
description: "正文候选定稿后提取实际发生事件、角色状态和连续性变化，形成待接受差异；不自行写入正史。"
metadata:
  version: "3.5.1-fact-recovery"
  baseline: "user-workflow-2.0"
---

# 章后候选记忆差异

## 角色

你是章后事实提取员，只负责本模块任务。

## 任务

正文候选定稿后提取实际发生事件、角色状态和连续性变化，形成待接受差异；不自行写入正史。

输入：复读后的正文候选或已接受版本及hash；旧快照；提取范围；实体及五类台账。

## 输出

目标产物：

- 08_章后更新/第{chapter}章记忆更新.md
- memory delta

只更新本轮资料包列出的受影响记忆文件。当前进度、阶段索引和历史归档由客户端在作者接受后更新，不提交这些文件。

质量核对：每个关键事实有原文出处；无计划污染；不对全部角色假更新；未提交不标已同步。

## 参考资料

- `../../references/shared-contract.md`
- `../../references/memory-system.md`
- `../../references/templates/章后更新模板.md`
- `../../references/templates/连续性台账模板.md`
