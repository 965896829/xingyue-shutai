# T-001—070验收映射

每项状态限于列出的证据范围。条件未执行和发布缺口分别列出，不把70行映射等同70项全部通过。

| ID | 场景 | 状态 | 证据 |
|---|---|---|---|
| T-001 | 原 BASE-01：结构版本 2 项目回收站操作 | 通过（本次隔离/合成验证范围） | refactor-compatibility.test.ts：复现修复、版本2回收/备份、恢复参数、真实构建号 |
| T-002 | 原 BASE-02：不接受补充指令的任务恢复 | 通过（本次隔离/合成验证范围） | refactor-compatibility.test.ts：复现修复、版本2回收/备份、恢复参数、真实构建号 |
| T-003 | 原 BASE-03：诊断版本 | 通过（本次隔离/合成验证范围） | refactor-compatibility.test.ts：复现修复、版本2回收/备份、恢复参数、真实构建号 |
| T-004 | 命令参数／结果类型错误 | 通过（本次隔离/合成验证范围） | refactor-boundaries.test.ts：四种静态反例与运行时schema拒绝 |
| T-005 | 未知命令、非可信来源 frame | 部分验证：未知命令与输入已测，非可信frame以实包能力隔离和守卫为界 | refactor-runtime.test.ts：未知命令/伪造字段拒绝；可信frame守卫；实包隔离frame另列 |
| T-006 | 主进程与 worker 协议不兼容 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：协议握手、pending回收和迟到；renderer AbortSignal不跨桥 |
| T-007 | 普通 IPC 超时及迟到响应 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：协议握手、pending回收和迟到；renderer AbortSignal不跨桥 |
| T-008 | 启动任务响应丢失后重复相同 operationId | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：持久收据、相同意图返回原结果、输入hash冲突 |
| T-009 | 相同 operationId 携带不同输入 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：持久收据、相同意图返回原结果、输入hash冲突 |
| T-010 | 旧项目会话命令与事件迟到 | 通过（本次隔离/合成验证范围） | refactor-boundaries.test.ts：会话/代次/资源版本、CAS、终结Execution不可复活 |
| T-011 | 非法 Run 状态转换 | 通过（本次隔离/合成验证范围） | refactor-boundaries.test.ts：会话/代次/资源版本、CAS、终结Execution不可复活 |
| T-012 | 同版本 Run 被两个控制动作竞争更新 | 通过（本次隔离/合成验证范围） | refactor-boundaries.test.ts：会话/代次/资源版本、CAS、终结Execution不可复活 |
| T-013 | worker 崩溃并重启 | 通过（本次隔离/合成验证范围） | desktop-smoke.json：真实worker终止恢复；活动请求正常退出；挂起worker后15秒强制收尾 |
| T-014 | worker 连续启动失败 | 单元门禁通过；连续启动失败的硬件/外部环境矩阵未穷尽 | desktop-smoke.json：真实worker终止恢复；活动请求正常退出；挂起worker后15秒强制收尾 |
| T-015 | 正常退出有活动任务 | 通过（本次隔离/合成验证范围） | desktop-smoke.json：真实worker终止恢复；活动请求正常退出；挂起worker后15秒强制收尾 |
| T-016 | 退出到达上限被强制结束 | 通过（本次隔离/合成验证范围） | desktop-smoke.json：真实worker终止恢复；活动请求正常退出；挂起worker后15秒强制收尾 |
| T-017 | 任务运行中切换项目 | 通过（本次隔离/合成验证范围） | refactor-boundaries.test.ts：活动聊天期间拒绝跨项目切换，原项目不变，drain释放锁 |
| T-018 | PID 重用／心跳失联 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：nonce锁、发送前落盘、未知费用、并发预算；独立进程kill补充 |
| T-019 | 模型请求前持久化失败 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：nonce锁、发送前落盘、未知费用、并发预算；独立进程kill补充 |
| T-020 | 发送意图之后硬终止 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：nonce锁、发送前落盘、未知费用、并发预算；独立进程kill补充 |
| T-021 | 流中途断开 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：nonce锁、发送前落盘、未知费用、并发预算；独立进程kill补充 |
| T-022 | 本地取消后远端仍可能执行 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：nonce锁、发送前落盘、未知费用、并发预算；独立进程kill补充 |
| T-023 | 用量缺失或价格缺失 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：nonce锁、发送前落盘、未知费用、并发预算；独立进程kill补充 |
| T-024 | 辅助摘要／评估／压缩请求 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：nonce锁、发送前落盘、未知费用、并发预算；独立进程kill补充 |
| T-025 | 多子任务并发预留预算 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：nonce锁、发送前落盘、未知费用、并发预算；独立进程kill补充 |
| T-026 | HTTP／SDK／执行器隐藏重试 | 通过（本次隔离/合成验证范围） | refactor-boundaries.test.ts：未知辅助调用停止续轮；实包重启接收次数不增加；旧重试回归 |
| T-027 | 用户明确重新请求未知结果 | 通过（本次隔离/合成验证范围） | refactor-boundaries.test.ts：未知辅助调用停止续轮；实包重启接收次数不增加；旧重试回归 |
| T-028 | 四类协议正常流式与续轮 | 通过（本次隔离/合成验证范围） | protocol.test.ts：四协议流式/非流式/续轮/原生字段；截断工具不调用handler |
| T-029 | 分片／截断工具参数 | 通过（本次隔离/合成验证范围） | protocol.test.ts：四协议流式/非流式/续轮/原生字段；截断工具不调用handler |
| T-030 | 重复工具调用重放 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：工具去重、参数冲突、伪造批准/正式工具拒绝 |
| T-031 | 同工具调用键出现不同参数 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：工具去重、参数冲突、伪造批准/正式工具拒绝 |
| T-032 | 模型伪造 approved／commit 工具 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：工具去重、参数冲突、伪造批准/正式工具拒绝 |
| T-033 | 路径穿越、链接与控制目录访问 | 通过（本次隔离/合成验证范围） | core.test.ts：越界/链接/控制目录，工具权限不能从资料或输出提权 |
| T-034 | 外部资料包含注入指令 | 权限边界通过；未宣称覆盖所有提示注入攻击语料 | core.test.ts：越界/链接/控制目录，工具权限不能从资料或输出提权 |
| T-035 | 日志、UI、诊断、错误与打包资源 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：脱敏、不可变候选指纹、审批失效与唯一提交 |
| T-036 | 候选产生后内容被修改 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：脱敏、不可变候选指纹、审批失效与唯一提交 |
| T-037 | 审批后依赖、项目或范围变化 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：脱敏、不可变候选指纹、审批失效与唯一提交 |
| T-038 | 同一候选重复点击采纳，包括不同 operationId | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：脱敏、不可变候选指纹、审批失效与唯一提交 |
| T-039 | 生成成功但尚未批准 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：脱敏、不可变候选指纹、审批失效与唯一提交 |
| T-040 | 对象保存后、DB 提交前崩溃 | 通过（本次隔离/合成验证范围） | refactor-crash.test.ts：四个独立进程硬终止边界，重复recover不重复提交 |
| T-041 | DB 提交后、文件同步前崩溃 | 通过（本次隔离/合成验证范围） | refactor-crash.test.ts：四个独立进程硬终止边界，重复recover不重复提交 |
| T-042 | 文件已替换、完成标记前崩溃 | 通过（本次隔离/合成验证范围） | refactor-crash.test.ts：四个独立进程硬终止边界，重复recover不重复提交 |
| T-043 | 同步期间外部文件变化 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：Windows TOCTOU精确插入外部字节并保留 |
| T-044 | 检查和替换之间插入外部写入 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts：Windows TOCTOU精确插入外部字节并保留 |
| T-045 | 文件被占用／无权限／磁盘满 | 占用真实验证、I/O失败注入通过；真实磁盘满/掉电未演练 | refactor-crash.test.ts：真实Windows FileShare.None占用；DB已提交/outbox待处理，解除后仅补物化 |
| T-046 | 代理事件订阅持久化被阻塞 | 通过（本次隔离/合成验证范围） | refactor-pi.test.ts：阻塞/失败checkpoint前工具计数0；显示订阅抛错不回滚 |
| T-047 | UI 订阅者抛错 | 通过（本次隔离/合成验证范围） | refactor-pi.test.ts：阻塞/失败checkpoint前工具计数0；显示订阅抛错不回滚 |
| T-048 | 必需上下文超容量 | 通过（本次隔离/合成验证范围） | studio.test.ts：容量、正式来源、派生记忆和索引/评估代次；gateway超容量不发包 |
| T-049 | 摘要过期／模型设想与正式事实混合 | 既有来源/正式事实回归通过；新增付费摘要关闭 | studio.test.ts：容量、正式来源、派生记忆和索引/评估代次；gateway超容量不发包 |
| T-050 | 旧索引／评估完成时来源已改变 | 通过（本次隔离/合成验证范围） | studio.test.ts：容量、正式来源、派生记忆和索引/评估代次；gateway超容量不发包 |
| T-051 | 用户未保存编辑遇到后台刷新 | 通过（本次隔离/合成验证范围） | desktop-smoke.json：实际编辑文本在资源刷新、worker死亡和完整应用重开后保留 |
| T-052 | UI 事件缺口、重复、乱序与新代次 | 通过（本次隔离/合成验证范围） | refactor-boundaries.test.ts：事件乱序/代次，450条新增跨页不丢；运行资源查询不扫文件/读聊天 |
| T-053 | 长会话游标分页时新增消息 | 通过（本次隔离/合成验证范围） | refactor-boundaries.test.ts：事件乱序/代次，450条新增跨页不丢；运行资源查询不扫文件/读聊天 |
| T-054 | 不相关资源频繁更新 | 通过（本次隔离/合成验证范围） | refactor-boundaries.test.ts：事件乱序/代次，450条新增跨页不丢；运行资源查询不扫文件/读聊天 |
| T-055 | 所有支持的旧项目升级 | 通过（本次隔离/合成验证范围） | refactor-crash.test.ts：schema迁移事务内kill回滚后重开；旧批准journal可验证来源 |
| T-056 | 迁移中断并再次打开 | 通过（本次隔离/合成验证范围） | refactor-crash.test.ts：schema迁移事务内kill回滚后重开；旧批准journal可验证来源 |
| T-057 | 未知未来项目／数据库版本 | 通过（本次隔离/合成验证范围） | refactor-compatibility.test.ts：未知版本拒写、WAL备份/缺对象/哈希校验、dry-run保留 |
| T-058 | 备份恢复及 WAL 中有数据 | 通过（本次隔离/合成验证范围） | refactor-compatibility.test.ts：未知版本拒写、WAL备份/缺对象/哈希校验、dry-run保留 |
| T-059 | 备份缺对象／hash 错／复制中断 | 通过（本次隔离/合成验证范围） | refactor-runtime.test.ts / refactor-compatibility.test.ts：缺引用对象/hash失败拒绝；32文件检查点取消后仅保留partial；重试新目录恢复，同名作者文件完整保留 |
| T-060 | 垃圾回收 dry-run | 通过（本次隔离/合成验证范围） | refactor-compatibility.test.ts：未知版本拒写、WAL备份/缺对象/哈希校验、dry-run保留 |
| T-061 | 清理与备份／活跃任务竞争 | 本轮全对象保留、无删除；未来细粒度pin/GC删除不在启用范围 | refactor-runtime.test.ts：维护资源互斥、GC默认无删除；损坏JSON保留原字节 |
| T-062 | 损坏全局 JSON／密钥解密失败 | 损坏JSON已验证；跨Windows账号解密失败未实机演练 | refactor-runtime.test.ts：维护资源互斥、GC默认无删除；损坏JSON保留原字节 |
| T-063 | 关闭新执行器开关 | 通过（本次隔离/合成验证范围） | refactor-pi.test.ts：Legacy默认、未知checkpoint只读；Pi真实循环的离线桥接实验 |
| T-064 | 未知 executor checkpoint 版本 | 通过（本次隔离/合成验证范围） | refactor-pi.test.ts：Legacy默认、未知checkpoint只读；Pi真实循环的离线桥接实验 |
| T-065 | Pi 假 provider 只读／草稿／候选链 | 离线实验通过，不代表Pi正式准入 | refactor-pi.test.ts：Legacy默认、未知checkpoint只读；Pi真实循环的离线桥接实验 |
| T-066 | 实际授权模型烟测（条件项） | 条件未执行 | executor-capability-matrix.md：缺真实端点/数据/费用明确授权；未调用实际收费模型 |
| T-067 | Windows 打包运行（目标平台项） | 通过（本次隔离/合成验证范围） | desktop-smoke.json：实际Windows10 x64 ASAR/非ASCII路径、版本、离线页面与关闭恢复 |
| T-068 | 覆盖安装和功能回退演练 | 未验证：需要隔离Windows升级环境 | rollback-runbook.md：保持appId/GUID/userData并交付安装包；未覆盖本机正在使用的安装 |
| T-069 | 性能同条件对比 | 通过（本次隔离/合成验证范围） | performance/comparison.md：同机同夹具p50/p95、内存、event-loop、payload与首次退化/优化复测；争用样本不用于阈值判定 |
| T-070 | 既有核心业务端到端回归 | 核心离线端到端与页面通过；实际供应商/图像服务未测 | feature-inventory.md：原143项+新增回归，完整S01—S11、标签、草稿和备份；实包页面抽测 |
