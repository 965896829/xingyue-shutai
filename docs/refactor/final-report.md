# 0.4.1改造交付报告

本文保留0.4.1交付时的事实和限制。后续0.4.2已隔离文档解析线程，性能见 [优化记录](optimization-0.4.2.md)；0.4.3策划中文说明见 [修复记录](planning-language-0.4.3.md)；0.4.4流程简化见 [记录](workflow-0.4.4.md)；当前0.4.5测试与安装包见 [开书体验记录](simple-start-0.4.5.md)。

完成等级：交付Legacy路径的架构改造验证版。新执行器正式准入、真实付费服务和Windows覆盖安装尚未完成，不标记为目标平台正式发布就绪。此交付等级采用方案19.1允许的“架构基础完成、新执行器未准入”路线，详细保留项见下文。

用户要求保持客户端UI且不新增代码注释。本轮保留既有窗口、组件结构、静态文字、图标、配色、样式和操作入口；改造渲染器的数据调用、历史分页、错误恢复与未保存编辑保护。没有新增可见设置或框架入口。

## 已交付实现

| 范围 | 实现与对应文件 |
|---|---|
| 契约和兼容 | `shared/contracts.ts`的106个命令同源输入/输出校验；typed client；project1/2、database4、build0.4.1和IPC1独立判断 |
| IPC和生命周期 | pending超时/取消/迟到清理，结构化错误、operationId、generation与projectSession；有限重启、握手、drain及15秒强制收尾 |
| 可靠执行 | Run版本竞争、终结不可复活的Execution、持久化Attempt/Tool/receipt/checkpoint；原生协议记录保留 |
| 正式提交 | ProjectCommitService绑定审批指纹、范围和快照；一次采纳；DB提交后outbox恢复；原稿保留与Windows无覆盖物化 |
| 远端和预算 | 模型及搜索/embeddings/封面等辅助请求统一登记；原子预算预留和未知费用；未知工具结果中断后续付费轮次 |
| 上下文和调度 | manifest来源、必要上下文容量保护、索引提交前版本核对；资源互斥、取消和本地恢复 |
| 查询与性能 | 资源读取、350ms合并、稳定游标分页、跨页增量补齐；watcher提示和60秒兜底；备份分批让出及持久化pending清单 |
| 迁移与恢复 | 迁移前含WAL的备份，迁移中断回滚；对象引用/hash检查；损坏配置和密钥失败原值保留；GC仅统计/dry-run |
| 执行器 | Legacy生产默认；锁定单一Pi0.73.1的真实循环离线桥接实验，未准入组合不自动启用 |

完整文件职责、调用出口和权威数据见 [仓库审计](repository-audit.md)、[调用图](call-path-map.md)、[数据权威](data-authority.md)。阶段任务记录见 [TASK_STATUS](TASK_STATUS.md) 及 phase-reports。

## 验证与证据

原始工作树基线143项回归全部通过；最终全量190项全部通过，0失败、0跳过，耗时202067ms；详见 [完整测试日志](test-evidence/test-final.log)。随后仅调整备份pending清单位置以避免作者同名文件冲突，定向1项通过并重新构建打包。类型检查、构建、打包、容量测试和资源完整性验证分别保存，不以单测数量替代平台验证。执行命令、环境、日志见 [验收索引](test-evidence/README.md)，T-001—070逐项结果见 [验收矩阵](test-evidence/acceptance-matrix.md)。

五个核心约束有故障证据：审批绑定候选；关键写入等待持久化；重复采纳只提交一次；替换竞争保留外部原字节；未知请求及工具结果不自动重试。覆盖独立进程硬终止、schema迁移中断、真实Windows独占文件句柄、DB已提交/物化待恢复、半写暂存文件和中断备份。

全局Playwright MCP连接真实Electron展开包，在隔离中文/空格路径及合成项目验证页面、错误契约、重复意图、未保存编辑、worker被杀后重开项目、正常关闭活动请求与挂起worker后的强制关闭。重开后的未知内容和费用仍保留，本地假服务总请求数为2，恢复没有增加请求。截图在 `output/playwright/refactor-*.png`；未使用真实作品、密钥或收费端点。

UI源码审计比较20个TSX组件的结构、静态属性和文字，26项CSS/图像资源逐字节一致；源码没有新增注释，UI没有core导入。最终ASAR核对worker构建、版本、资源和测试标记，生产包不包含Pi。详见 [source-audit](test-evidence/source-audit.json) 和 [delivery-report](test-evidence/delivery-report.json)。

同机性能原始样本、p50/p95、内存、数据库大小、事件循环延迟与消息体积见 [性能报告](performance/comparison.md)。保留首次退化样本和提交阶段profiling；优化只减少私有临时文件和新备份目录中的重复rename，未删除fsync、审批、恢复或hash校验。11轮序列提交仍出现长尾；51对交替复测p95增加5.5%、p50增加约10ms，备份最终p95与基线接近。未将抖动样本删掉或宣称所有操作都更快。

## 剩余限制与安全默认

- Pi仅开发依赖和离线实验。四协议全矩阵、完整取消/切换、辅助功能组合、Pi实包与供应链门禁未准入；开发树仍有8项moderate和6项high，生产依赖审计为0。不会因实验存在就切换默认执行器。
- 真实付费模型、图像服务与质量对比没有明确费用授权，按方案保持未执行。T-068需要隔离Windows升级环境，未覆盖本机正在使用的安装。
- 大型DOCX导入仍为原30MB上限内的同步预览解析；未实现任意大文档的分块持久化导入。备份中断保留已刷盘pending清单，重试另建目录，不跨源快照拼接；索引按现有分块记录恢复。
- GC删除和付费摘要保持关闭，所有历史对象保留；没有把未来细粒度pin/删除中断验收写成已完成。真实断电、磁盘填满、SMB/FAT和跨账号DPAPI失败仍需环境验证。
- 自动更新未实现，Windows产物未签名。错误状态沿用原UI显示，不引入改变布局的新界面。

详见 [执行器准入矩阵](executor-capability-matrix.md)、[发布清单](release-checklist.md)、[风险登记](risk-register.md) 和 [回退操作](rollback-runbook.md)。不降低数据库版本；旧程序仅配合升级前备份的新目录使用。

## 交付与工作树

安装包：`release/refactor/星月书台 Setup 0.4.1.exe`。展开版：`release/refactor/win-unpacked/星月书台.exe`。版本、大小和SHA256写入交付完整性报告。

工作树起点为 `ade3d5c`，含用户已存在的品牌、主题、标签与退出窗口改动。基线按本轮开始时文件hash核对，没有拿旧HEAD替代当前产品。原方案保存为 [plan.md](plan.md)。所有本轮修改留在工作树，未提交、推送或发布；原安装、真实用户配置和旧release产物保留。
