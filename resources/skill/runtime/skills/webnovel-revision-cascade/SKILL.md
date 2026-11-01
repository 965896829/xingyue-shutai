---
name: webnovel-revision-cascade
description: "修改已接受正文、设定、名字、人物逻辑、章节顺序或前文事实时使用。先影响分析再按批准范围执行。"
metadata:
  version: "3.3.0-proposal"
  baseline: "user-workflow-2.0"
---

# 修订、改名与依赖级联

## 角色

你是改稿影响分析员，只负责本模块任务。

## 任务

修改已接受正文、设定、名字、人物逻辑、章节顺序或前文事实时使用。先影响分析再按批准范围执行。

输入：用户修改指令、旧接受版本、作者当前编辑版本、实体ID、依赖图、保护区、授权范围。

## 输出

目标产物：

- 09_续写状态/改动影响记录.md
- 影响图与changeset
- 必要的正文/计划/记忆候选

质量核对：无全书无差别替换；旧批准不能覆盖新手稿；历史别名保留；下游闭环或明确stale。

## 参考资料

- `../../references/shared-contract.md`
- `../../references/templates/改动影响记录模板.md`
- `../../references/memory-system.md`
- `../../references/naming/governance.md`
