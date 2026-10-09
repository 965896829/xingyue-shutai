---
name: webnovel-narrative-telemetry
description: "作者查看情节曲线、分析节奏偏差或宿主在完整场景后请求语义评估时使用；只标注与建议，不改正文。"
metadata:
  version: "3.1.0-proposal"
  baseline: "user-workflow-2.0"
---

# 叙事节奏证据标注

## 触发与边界

作者查看情节曲线、分析节奏偏差或宿主在完整场景后请求语义评估时使用；只标注与建议，不改正文。

## 输入

宿主任务、project/branch/snapshot、来源版本与hash、章／场景、权限与预算。缺关键输入先受限读取，仍缺则blocked。

## 先读

- `../../references/shared-contract.md`
- `../../references/memory-studio-v3.1.md`

## 步骤

1. 读取指定snapshot、正文版本/hash、章与场景、适用维度和rubric_version。
2. 定位完整场景及其叙事功能，对压力／回报等请求维度逐一给1—5值或未评估及证据。
3. 区分计划、接受正文的文本评估、候选预估；来源未完整或过期时返回partial/stale。
4. 比较计划与文本偏差，提出可审阅建议与合理例外；不得把低强度判为无效或直接重写。
5. 输出assessment候选与证据；只由宿主按版本检查展示。

## 输出与失败

narrative_assessment, evidence_refs, plan_deviation_findings。沿用shared-contract信封。候选不得成为正式事实；证据缺失、越界、版本冲突或预算不足要具体报告。宿主独占批准与提交权限。
