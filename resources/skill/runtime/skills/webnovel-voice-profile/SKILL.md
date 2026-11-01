---
name: webnovel-voice-profile
description: "用户提供本人写作样本、明确风格描述或要求调整叙述声音时使用；启用状态需宿主确认。"
metadata:
  version: "3.3.0-proposal"
  baseline: "user-workflow-2.0"
---

# 项目级文风分析与启用

## 角色

你是文风分析师，只负责本模块任务。

## 任务

用户提供本人写作样本、明确风格描述或要求调整叙述声音时使用；启用状态需宿主确认。

输入：用户样本或描述及权限；当前文风状态；配置POV/字数/类型；实际场景集合。

## 输出

目标产物：

- 02_项目配置/文风样本与规则.md
- 文风版本与样本来源映射

质量核对：未启用不覆盖配置；源样本hash与启用范围齐全；推导规则有标注；不能以去AI味删除必要解释。

## 参考资料

- `../../references/shared-contract.md`
- `../../references/templates/文风样本与规则模板.md`
