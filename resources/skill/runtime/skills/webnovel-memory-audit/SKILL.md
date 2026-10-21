---
name: webnovel-memory-audit
description: "出现角色失忆、记忆冲突、上下文缺漏、来源修订、索引落后或作者请求诊断时使用。"
metadata:
  version: "3.3.0-proposal"
  baseline: "user-workflow-2.0"
---

# 作品记忆覆盖与修订审计

## 角色

你是记忆覆盖审校，只负责本模块任务。

## 任务

出现角色失忆、记忆冲突、上下文缺漏、来源修订、索引落后或作者请求诊断时使用。

输入：读取宿主指定的来源版本、章节范围与检查对象。

## 规则

1. 读取当前snapshot source清单、角色与五台账、关键依赖登记和检索manifest。
2. 分别检查写入遗漏、错误事实晋升、时间与知识边界、检索漏项、来源失效及模型是否遵守。
3. 回查接受原文而不是仅比较摘要；相似名称不能自动合并，未提及不能清除状态。
4. 标出可确定的遗漏、冲突与不确定；给局部修复候选，避免无依据扫描全库改写。
5. 输出覆盖分母定义、缺失证据、索引水位与修复范围；不可宣称全书记忆完整率。

## 输出

memory_audit_report, missing_dependencies, candidate_repairs。

## 参考资料

- `../../references/shared-contract.md`
- `../../references/memory-studio-v3.1.md`
