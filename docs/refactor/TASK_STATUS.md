# 阶段状态

当前源码版本为 0.4.14（2026-10-15），新增“确认故事方向后确定书名”，实现、测试与安装状态见 [当前交付记录](deferred-title-0.4.14.md)。

以下为截至 2026-10-11 的架构改造阶段基线，不代表当前安装版本。按真实实现和已执行证据填表；不把外部框架实验、缺授权和缺隔离升级环境计为正式完成。

| 阶段 | 范围 | 状态 | 证据 |
|---|---|---|---|
| P00 | 仓库盘点与基线 | 完成 | [记录](repository-audit.md) |
| P01 | 兼容与命令契约 | 完成 | [记录](command-inventory.md) |
| P02 | IPC与进程生命周期 | 完成隔离验收 | [记录](test-evidence/desktop-smoke.json) |
| P03 | 状态与可靠持久化 | 完成 | [记录](legacy-state-mapping.md) |
| P04 | 审批与正式提交 | 完成隔离验收 | [记录](data-authority.md) |
| P05 | 模型/工具/预算网关 | 完成离线验收 | [记录](call-path-map.md) |
| P06 | 上下文/调度/恢复 | 完成现有路径 | [记录](data-authority.md) |
| P07 | Legacy接口与Pi实验 | 实验完成，正式准入未完成 | [记录](executor-capability-matrix.md) |
| P08 | 查询/分页/编辑保护 | 完成数据流改造 | [记录](feature-inventory.md) |
| P09 | 性能与文件检测 | 完成测量、备份分批、提交配对复核和导入线程隔离；持久化分块导入保留项 | [原记录](performance/comparison.md)、[0.4.2](optimization-0.4.2.md) |
| P10 | 迁移/容量/回退 | 数据路径完成，覆盖安装未验收 | [记录](migration-matrix.md) |
| P11 | 最终验证与交付 | 交付Legacy验证版0.4.5；发布门槛有保留项 | [架构交付](final-report.md)、[后续优化](optimization-0.4.2.md)、[策划修复](planning-language-0.4.3.md)、[流程简化](workflow-0.4.4.md)、[开书体验](simple-start-0.4.5.md) |

UI保持原有视觉样式，0.4.4—0.4.5按作者反馈合并流程操作、简化默认开书并折叠辅助操作，未增加代码注释。安全默认：Legacy、无自动未知重试、无新插件/MCP、无GC删除、无自动更新或签名。不在作者真实数据上做破坏性演练。
