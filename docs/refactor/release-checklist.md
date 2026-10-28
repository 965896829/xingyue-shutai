# 发布检查清单

当前源码版本为 0.4.78，新任务默认 Pi。实现与验证范围见[执行器准入矩阵](executor-capability-matrix.md)，原始日志在 `output/pi-integration-0.4.78-20261028/`。本轮不覆盖安装、不跑真实模型。

以下为历史发布检查清单：0.4.5 的 210 项回归见 [开书体验记录](simple-start-0.4.5.md)，表格保留 0.4.2 检查清单及 0.4.1 原故障证据，不代表当前安装版本或当前 Pi 准入状态。

| 检查项 | 状态 | 证据 |
|---|---|---|
| 原功能回归与新增故障测试 | 197项全部通过 | [测试日志](optimization-evidence/tests.log) |
| 类型检查、四入口构建 | 已执行，构建包含tsc检查 | [构建日志](optimization-evidence/build.log) |
| 真实Windows10 x64打包运行 | 0.4.2已在隔离userData和合成项目验证导入；原生选择框使用测试桩 | [桌面证据及边界](optimization-0.4.2.md) |
| 主进程、preload、worker、document-worker一致 | 构建0.4.2，协议1，四入口与ASAR逐一匹配 | [源码及ASAR审计](optimization-evidence/source-audit.json) |
| UI结构、静态文字与视觉资源 | 与原改造前工作树一致 | [UI审计](optimization-evidence/source-audit.json) |
| 不新增代码注释、UI不依赖core | 源码及辅助代码审计通过 | [源码审计](optimization-evidence/source-audit.json)、[辅助核对](optimization-evidence/review.json) |
| 项目1/2和数据库1/2/3→4 | 合成迁移、迁移中断和旧事务重复恢复通过 | [兼容矩阵](migration-matrix.md) |
| 活动请求退出与强制收尾 | 正常drain释放锁；挂起worker约15秒强制收尾 | [正常退出](test-evidence/graceful-close.json)、[强制退出](test-evidence/forced-close.json) |
| 0.4.2导入退出清理 | 活动和排队导入取消；实际展开包退出后锁释放、源文件不变 | [新增回归](optimization-evidence/tests.log)、[退出清理](optimization-evidence/cleanup.json) |
| 未知请求重开不自动调用 | 本地假服务总计2次请求，重开未增加 | [恢复证据](test-evidence/forced-recovery.json) |
| 备份、引用对象与完整性 | 缺对象/损坏拒绝恢复；完整备份恢复到新目录 | [测试映射](test-evidence/acceptance-matrix.md) |
| 资源与安装包完整性 | 源码资源和ASAR逐项核对 | [交付完整性](optimization-evidence/delivery-report.json) |
| 生产依赖审计 | 0漏洞；不能代替开发依赖审计 | [生产审计](test-evidence/audit-production.json) |
| Pi正式准入 | 未通过完整GATE-01—10；默认关闭且不入生产包 | [执行器矩阵](executor-capability-matrix.md) |
| 实际付费模型T-066 | 条件未执行，缺明确端点/数据/费用范围 | [测试映射](test-evidence/acceptance-matrix.md) |
| 覆盖安装、卸载和数据位置实测T-068 | 未验证；未覆盖用户现有安装 | [回退说明](rollback-runbook.md) |
| 自动更新、签名 | 未实现自动更新，产物未签名 | package.json的现有分发配置 |
| 真实断电/磁盘满、非NTFS文件系统 | 未实机验证；不可用注入测试代替 | [风险登记](risk-register.md) |

安装产物位于 `release/optimization/星月书台 Setup 0.4.2.exe`，展开版位于 `release/optimization/win-unpacked/星月书台.exe`。0.4.1产物保留在release/refactor。appId、NSIS GUID和userData名称保持原值；这些静态检查不等同覆盖安装已通过。生产用户目录和原安装未修改。

正式发布前先在隔离Windows用户或虚拟机执行旧版→新版覆盖安装、卸载保留数据与旧备份恢复。新执行器、实际供应商和图像服务的验证另按矩阵执行，不自动开启收费请求或框架开关。
