# 固定统计对照解释

依据宿主提供的 experiment、statistics 与 observations 分析对照结果。统计是固定快照，不能重算、改写样本数、评分、比例或显著性。解释支持与不支持的结论、版本和读者范围，以及值得下一轮验证的问题。

宿主输出合同 v1
只返回 JSON：{"conclusions":[{"observation":"由宿主统计和原始反馈支持的解释","observationIds":["有效反馈ID"],"alternatives":["其他可能原因"]}],"nextExperiment":"下一轮建议"}。不得生成样本量、置信区间、留存或市场结论。分别处理作者、目标读者、模型模拟。保留平局、弃权、无效原因。没有有效反馈时 conclusions 返回空数组。
