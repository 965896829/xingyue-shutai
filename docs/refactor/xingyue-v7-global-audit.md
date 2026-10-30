# V7 全局复核与 0.4.87 交付

后续修复见 [0.4.88 作品方案与书名入口](xingyue-v7-title-button-fix.md)：补齐创作与发布投影的策划校验，并重查已有候选。下文的 0.4.87 测试及安装记录作为历史基线保留。

2026-10-30。按 xingyue-agent-design/design/implementation-backlog-v7.md 的 R0—R5 复核，继续保留 V3/V4 的数据、人物、恢复合同及 V5/V6 的平台、世界、创作与质量要求。实际 Git HEAD 为 b505f6f459db74871f39f63acf6106b827c8a353；本次修改保留在工作区，没有提交 Git，没有改写原方案的验收结果。

先前“工程已完成”的记录范围不够完整：本次发现并补齐了公开分类入口、平台样本证据、多体系成长合同以及界面和采纳边界。历史记录保留，当前状态以本文和 0.4.87 交付清单为准。

## 本次补齐

| 问题 | 完成的行为 | 实现及验证 |
| --- | --- | --- |
| 新建作品看不到番茄题材 | 直接显示创作题材和发布频道，选频道后出现主分类；已有设定和自由创意两种开书方式都可用 | BookProfileFields.tsx、App.tsx |
| 只有旧男频目录 | 接入公开书库 336 项：男频 154、女频 182；主分类分别 19、21 项；独立保存 37 个榜单入口、154 个旧 optionId/conceptId 对照 | resources/skill/platform、publishing.test.ts |
| 目录没有来源与版本管理 | 保存来源、观察时间、摘要、提取器版本；刷新先比较差异，作品固定原快照；部分失败、缺分组或数量明显减少时保留旧完整目录 | core/publishing.ts、scripts/import-publishing-catalog.ts --check |
| 创作题材和发布分类混用 | 独立存储；只改发布分类不重写题材、世界和原始设定。改创作题材先生成配置候选，统一采纳；开书初期不要求先补全 S02 策划字段 | publishing.propose、commands/adoption.ts、runner.ts |
| 普通写作页缺少分类设置 | “作品设置”增加“题材与发布分类”；管理页保留入口；修改校验快照和来源，保存后可重开恢复 | PublishingSettings.tsx、platform-ui.json |
| 分类被旧开书草稿带回 | 正式分类修改后同步开书草稿的分类与目录版本，保留原想法和作者约束，旧方案失效并留作历史；单独编辑草稿时保留作者尚未采纳的选择，重启可恢复 | currentCreationDraft、publishing.test.ts |
| 三方向缺少世界模块建议 | 新版一次请求返回三个轻量方向、模块建议及相关假设；局部重做同时保护被冻结的故事、假设和模块建议；旧任务保留原格式 | tag-planning.ts、shared/tags.ts |
| 成长体系合同不完整 | 多体系 ID、版本、适用人物/阵营、有效章节、原文、未解析内容、前置阶段和显式跨体系规则；不擅自折算战力；模型不能修改固定体系 | world-model.ts、shared/quality.ts |
| 成长路线编辑没有闭环 | 新增、编辑、固定、比较和采纳；候选可读显示阶段、边界、前置与版本；保存后保留视图，布局不改事实。只禁止前置依赖环，允许反馈因果环 | GrowthSystems.tsx、WorldWorkbench.tsx、WorkbenchCandidates.tsx |
| 样本只有搜索摘要 | 接通官方榜单和书页，保留统计截止/采集时间、分类关系、样本选择、分页范围、字段来源；使用 read_count，不误读 readCount；编码字形和未知首次发布时间不猜补 | market-evidence.ts、market-evidence.test.ts |
| 样本失败与调用边界不完整 | ready / partial / stale / unavailable / disabled；无对应榜单不伪造，近邻必须明确选择同频道分类；公开资料读取不调用模型 | publishing.market、commands/design.ts、title-market-research.ts |
| 显示书名被当作 Windows 文件名 | 显示名允许冒号、斜线等标点；存储目录和导出名独立适配；同名新作品不覆盖，定名保持原目录；仍拒绝控制字符并遵守显示长度限制 | file-names.ts、title-naming.ts、commands/adoption.ts |
| 启动偶发 undefined.id | 旧任务缺失基准快照时增加空值防护与恢复状态；原报错无法稳定重现，此项不能作为已经确认的原始根因 | service.ts、原生启动复核 |

公开书库分类和榜单不等于作家后台对具体账户、作品形式的全部发布限制。原有 328 个内容标签仍是既有资料，不冒称已被后台实时核验。来源说明收纳在折叠区域，界面不显示内部 JSON 或 HTML 注释。

## 按方案全局复核

| 方案范围 | 工程状态与证据 |
| --- | --- |
| V7 R0 基线、恢复、旧任务 | 复用正式内容、候选、请求、工具回执各自账本；未知付费请求不自动重发，旧 executor/checkpoint/prompt 保留版本。架构、幂等、恢复、故障注入和兼容回归覆盖 |
| V7 R1 命令与工作流 | 开书、章节、讨论、修订及采纳可分开定位；模型和工具经统一网关，宿主登记工具权限。见 commands、workflows、runtime/tool-contracts.ts |
| V7 R2 版本、激活与视角 | 26 个旧技能、19 个设计包、48 个操作有真实处理器和版本路由；作者、读者前缀、单角色整请求分离；空查询也参加依赖校验。见 architecture-v7.test.ts、creative-context.ts |
| V7 R3 / V3 正文、人物、记忆 | 最终正文 hash、出场者覆盖、核心记忆和独立核对同版采纳；事件、计划、误信、未知、无变化分开；旧章改稿重新核对；证据按 Unicode 码点。见 chapter-memory.ts、revision-core.ts、commit-kernel.ts 及相关回归 |
| V7 R4 / V3 查询与索引 | 增量事实索引、来源复用、局部查询、水位及全量重建保留。历史 100/500/1000 章性能证据属于合成工程负载，不等于真实长篇质量。见 fact-index.ts、memory-studio.ts、xingyue-v7-performance.json |
| V5 A 分类基础 | 本次补齐快照、频道、表面、刷新和直接入口；旧 ID 与作品选择保持。目录重建、单元测试及浏览器验收覆盖 |
| V5 B 动态世界 | 12 个可选模块和 custom、三态、原文、锁、候选和压力测试入口保留；新增多体系、方向建议、新任务合同。S03 旧任务原合同恢复。见 world-platform-completion.test.ts |
| V5 C 标题与承诺 | 本次接通公开样本来源与降级；标题依已确认计划和承诺，实体名不要求榜单；显示与存储独立。见命名、市场证据和完整工作流回归 |
| V5 D / V4 共创画布 | 人物、关系、知情、剧情四层、场景、调序、因果、线索、承诺、双时序、地图、资源、节奏复用正式投影；语义修改为候选，布局只存偏好。见 object-workbench、workbench-visual、流式及 Unicode 回归 |
| V5 E / V6 A 迁移与实验 | Markdown 原文、ID、来源、在途任务保留；匿名样稿、预登记、预算与配置可追溯。见旧作品隔离回放、blind-review.test.ts、quality-workbench.test.ts |
| V6 B 声音与编辑 | 保留编辑前后与来源，纠错/未知原因/审美分开，支持作用域、撤回和版本控制。见 quality.ts、voice-pilot 和声音回归 |
| V6 C 探索与排演 | 空作品可探索，单角色仅获可见包；分支回放、比较、转候选，最终正文重新审核提取。见 creative-v7.test.ts、分支工作台 |
| V6 D 首读与体验 | 整请求按实际截止编译，隔离未来和作者秘密；模拟不计为真人反馈，附属观察失败不破坏核心。见 experience.ts、canary 和范围回归 |
| V6 E 解法与工作台 | 按来源比较冲突、策略、回应、解法及回报，允许有意回响；复用现有 React/SVG，没有无依据增加外部图服务 |
| V6 F / V7 R5 发布与实际质量 | 本地功能、真实模型、真人盲评、长篇与平台指标分层记录；宿主可用不等于文学质量通过，外部范围见下文 |

## 验证

日志简称均位于 .test-output/xingyue-v7。

- platform-targeted.tap：分类、市场和目录回收 22 项通过。
- world-targeted.tap：世界、核心、方案 43 项通过。
- platform-boundary.tap：分类采纳及新旧多体系合同 9 项通过。专项与全量重叠，不相加。
- platform-draft-sync.tap：草稿同步及策划、命名、冻结方向相关 90 项通过；正式分类不会被旧草稿带回，作者尚未采纳的草稿选择仍保留。
- platform-full-first.tap：第一轮 878/880；两项旧断言仍要求斜线书名失败，按显示名与存储名分离要求改为检查换行/控制字符必须拒绝后重跑。
- platform-full.tap：最终 880/880 项通过，失败、跳过、取消均为 0，用时 684.781 秒；包含最后的正式分类与草稿同步修复。
- platform-final-build.log、platform-installer.log：TypeScript、前端、Electron 构建及 NSIS 安装包生成通过。platform-delivery.log 校验 176 个程序文件、223 个技能及分类资源文件与构建输出一致，资源锁匹配，19 个设计包、48 个操作、26 个旧技能映射齐全。校验脚本已修正 Windows 路径分隔符处理；首次提示的文件不存在并非安装包缺失。
- output/xingyue-v7/delivery-0.4.87.json：安装包 127,515,307 字节，SHA-256 为 143bef4dd0febc23990d204adcf201204141d9cb22a83c53d7ff2908d6a3e01a。
- platform-ui.json：真实 Service/SQLite 的隔离作品；目录选择前请求 0，三个方向只用 1 次确定性模拟请求；完成分类/题材/成长路线候选、正式保存、重开恢复和公开资料读取，后续模型请求 0；无页面未捕获异常。未操作正式用户作品。
- platform-replay-qRSDiW/report.json、integrity.json 及 platform-final-replay.json：4 部现有作品的隔离副本打开、快照、关闭、重开及最终代码复核通过，模型调用为 0。104 个文稿文件、481 个内容对象、20 个快照和 24 个任务的原文、身份、请求与预算保持；这是兼容回放，不是实际长篇续写质量验收。
- 800×700、1280×900 无页面横向溢出，图表在内部滚动；实际查看新建、候选和日间/夜间截图。文件为 output/playwright/v7-87-*.png。
- platform-market-live.json、platform-catalog-live.json：官方接口实测 336 项分类；都市脑洞新书榜首批 10 条，取前 6 本核验书页标题。第一名在读字段为 read_count=276286，统计截止原文 10-29 24:00，首次发布时间仍未知。快照有时效，不能据此推断销量或书名效果。

## 仍须外部材料的验收

当前没有真人盲评反馈和真实长篇材料。默认模型授权的 100 次评测调用已经用完，本轮新增付费调用为 0。既有 93 条模型观察、31 组匿名样稿及失败和长度偏差继续保留，见 [质量结果](xingyue-v7-quality-results.md)。

真人偏好、真实长篇连续叙事和人物因果质量、平台留存及商业效果仍未通过验收。48 个操作的宿主入口不等于全部完成独立真实模型测试。本轮新分类、多体系和模块建议的合同经过本地回归，尚未追加付费调用验证实际生成质量。原方案案例的未执行标记没有改成通过。

## 安装和恢复

安装包为 release/xingyue-v7/星月书台 Setup 0.4.87.exe，已更新 D:\aiwenxu\wenxu-desktop，实际文件版本 0.4.87.0，安装器退出码 0。298 个安装文件与已校验的 win-unpacked 逐一匹配；首次启动前 5 个配置文件与备份字节一致，4 部已有作品目录保留。

本次配置与加密状态备份为 C:\Users\OS\AppData\Roaming\wenxu-desktop-upgrade-backups\0.4.86-to-0.4.87-20261030-020331。安装、文件校验和启动结果记录在 .test-output/xingyue-v7/platform-installed.json；历史安装包和版本清单保留。

原生冷启动显示 v0.4.87 和四部已有作品，未见 Cannot read properties / undefined.id 报错。通过键盘打开“新建作品”，确认创作题材与番茄发布频道入口可见，没有创建正式测试作品或触发模型调用。当前 Windows 10 不支持此工具的截图接口，原生验证采用可访问性文本；男女频选择、保存恢复和视觉排版由全局 Playwright 隔离验收覆盖。原生文本保存在 platform-native-home.txt、platform-native-new-project.txt。

新分类资源不覆盖旧 taxonomy；旧作品不需整库迁移。分类和世界修改通过可比较候选进入已有事务。回退使用保留的安装包、配置备份和作品历史，不删除请求账本、原文或已有选择。
