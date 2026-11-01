# 星月书台 V7 实施与验收记录

最新交付版本为 0.4.85，剩余可视化工程、866 项回归、安装包及外部验收边界见 [工程收尾记录](xingyue-v7-completion.md)。0.4.84 的共创入口和离线试读见 [续作记录](xingyue-v7-continuation.md)。下文保留 0.4.83 当时的测试和性能证据，不将旧测量冒充新版本结果。

2026-10-29，项目版本 0.4.83。工程实现、自动回归、真实模型测试和 Windows 安装包已完成；真人盲评尚待作者及目标读者提交。不能据此宣布文学质量、平台收益或真实百万字小说的一致性全部通过。

## 交付物

- 安装包：`release/xingyue-v7/星月书台 Setup 0.4.83.exe`。
- 0.4.83 安装包 SHA-256、资源校验与版本：`output/xingyue-v7/delivery-0.4.83.json`。
- 可离线打开的匿名评阅页：`output/xingyue-v7/anonymous-review.html`。
- 实际调用、失败记录、长度分层与同版提交证明：`output/xingyue-v7/evaluation-report.json`。
- 性能原始样本及比较：`docs/refactor/xingyue-v7-performance.json`。
- 详细质量观察：`docs/refactor/xingyue-v7-quality-results.md`。

基线为 `b505f6f459db74871f39f63acf6106b827c8a353`、分支 `main`。沿用现有 Pi、Electron、SQLite、模型网关和统一采纳事务。开始时已有的 13 个版本、依赖与品牌文件变更，以及作者提供的设计目录和压缩包均保留；没有提交 Git、修改原设计案例状态或覆盖用户安装目录。

## 已接通的实现

| 范围 | 当前行为 | 主要实现 |
| --- | --- | --- |
| R0 基线 | 先执行 91 项恢复、提交和兼容回归，再按影响范围复验 | `.test-output/xingyue-v7/baseline.tap` |
| R1 模块拆分 | 开书、章节、讨论、修订各有工作流；采纳、讨论、设计操作有命令入口；工具效果由宿主登记 | `src/core/workflows/`、`src/core/commands/`、`runtime/tool-contracts.ts` |
| R2 版本与范围 | 新任务保存 workflow、handler、registry、contextPolicy、executor、checkpoint、budgetOwner；空查询也参与依赖校验；未知付费请求不自动重发 | `runtime/workflow-contract.ts`、`runtime/fact-read-set.ts`、`creative-context.ts` |
| R3 同版核心 | 新章、旧章改稿及分支合并冻结最终正文，以相同 hash 提取人物覆盖、核心事实及独立审核，再统一采纳 | `chapter-memory.ts`、`workflows/revision-core.ts`、`runtime/commit-kernel.ts` |
| R4 索引与查询 | 按变更台账和来源反向索引更新事实；来源内容在同次查询中复用；待核对状态改变会使相关投影失效 | `fact-index.ts`、`memory-studio.ts`、`storage.ts` |
| R5 创作工具 | 编辑证据、声音学习与试写、独立首读、人物回合、自由探索、剧情解法、反馈比较、动态世界与分支工作台 | `quality.ts`、`world-model.ts`、`experience.ts`、`ui/QualityWorkbench.tsx` |

设计包的 **19 个能力包、48 个操作**均有宿主入口。7 个隔离操作使用 `creative-v7-v1`，其余 41 个使用有明确目标文件、输入和读集约束的 `scoped-design-v1`，复用现有策划、命名、修订和审核执行器。原 26 个技能资源及其锁保持兼容。目录启用不等于每个操作均已用真实模型独立验收：真实调用覆盖范围在质量记录中逐项说明。

该版本曾使用 `scripts/import-creative-design.mjs` 导入设计资源；该导入器已于 2026-10-30 退役，不能再用历史 V6 设计稿覆盖现行规则。当前提示词直接维护在 `resources/skill/`，审阅改动后通过 `scripts/update-prompt-locks.mjs` 更新资源锁。下述安装包核对记录属于当时版本，不代表当前工作区已经重新打包安装。

## 数据和提交边界

正式文件、事实和版本仍由 ProjectCommitService → FileStore 的事务与物化 outbox 写入。模型请求使用既有 `model_attempts`，工具效果使用 `tool_executions`，命令幂等使用 Operations。创作投影没有正式采纳权。

章后人物覆盖支持变化、核对后无变化、依据不足、仅提及四种结果。稳定人格、当前状态、误信、计划与正文事件分别保留。覆盖与事实引用最终正文版本，未具名的出场人员也须接受独立核对；不能为了填表制造变化。证据按 Unicode 码点定位，唯一原文可本地纠正坐标，歧义或错误版本不会被自动认证。

旧章改稿先保存候选。定向修复只开放记忆文件、被否定的事实及覆盖，冻结正文和未被否定的事实；修复后再次独立核对。正式提交校验的是实际编码进台账的核心事实，不能只交一份通过摘要。所有修复和审阅计入同一任务预算，未知请求不盲目重发。

增量索引跟踪来源当前可用性，防止同字节来源因待核对状态被错误复用。撤回、取代的事实也保留台账状态用于关闭复核队列，避免已撤回事实仍显示待核对。附属学习数据损坏不会阻断已完成核心版本的浏览或手工保存。

## 创作体验

- 工作台包含声音、编辑记录、对比试读、剧情解法、世界模块、分支、阅读轨迹七个视图。
- 手工改稿保存前后版本、Unicode 原文范围、修改者、原因和用途。纠错、原因未知或一次局部编辑不能被自动提升为全书审美；证据撤回或来源改变会停止偏好参与后续请求。
- 首读仅获取实际阅读前缀、作者明确展示的书名和简介。人物回合仅获取该人物可知的信息及可观察的上一回合，不附作者真值、秘密引文或另一人物的内心。
- 分支可保存版本、从历史版本分叉、并排比较、替换或追加到章候选。进入正式作品前重新核对最终正文与记忆；不直接写正史。
- 12 类世界模块及自定义模块可启用、停用、未定或固定。旧世界原文、来源 hash 和作者选择保留；没有强制境界、金手指或代价栏。
- 反馈保存匿名展示顺序、样稿 hash、参与者、来源、原始选择、平局、都不满意、弃权、撤回及排除原因。作者、目标读者和模型模拟分别统计。预登记方案绑定创意族、配置、范围、预算和停止条件。
- 阅读轨迹由正式事实、计划、首读结果及真实反馈派生。切换、筛选与查看不调用模型；计划不显示为已经兑现，模型观察不计作真人反馈。

声音偏好和模块化世界在客户端以可读正文呈现，隐藏内部 JSON、hash 和实现说明。删除了多处说明性提示，工作台采用可滚动布局与按需展开；800×700 和 1280×720/800 下已检查溢出。声音偏好采纳不会再误触发剧情同步。

## 验证结果

| 验证 | 结果 | 证据 |
| --- | --- | --- |
| 全量自动回归 | 843/843 通过，0 失败、0 跳过 | `.test-output/xingyue-v7/full-final.tap` |
| 最终人物规则相关复验 | 22/22 通过；与全量用例重叠，不能相加 | `.test-output/xingyue-v7/final-targeted.tap` |
| TypeScript、Vite、Electron bundle | 通过；Vite 保留大 chunk 提示 | `.test-output/xingyue-v7/build-final-2.log` |
| NSIS x64 安装包 | 生成成功，资源 hash 校验通过 | `.test-output/xingyue-v7/installer-delivery.log`、`delivery.json` |
| 真实默认模型 | 100/100 次授权调用已使用，实际价格未知 | `live-quality/budget.json`、`evaluation-report.json` |
| 1200 章 / 300 万字容量 | 提交、扫描、编号与检索通过 | `.test-output/scale-report.json` |
| Playwright | 声音采纳/试写、分支、世界候选、匿名反馈、解法、阅读视图、布局与停止响应已操作 | `output/playwright/v7-*.png`、`ui-performance.json` |

运行命令：

```powershell
node --import tsx --test --test-concurrency=2 --test-reporter=tap tests/*.test.ts
node --import tsx --test --test-concurrency=2 tests/creative-v7.test.ts tests/design-operations.test.ts tests/revision-core.test.ts tests/quality-workbench.test.ts
npm run build
npm run test:scale
node --import tsx scripts/benchmark-memory-v7.ts delivery --extended
node node_modules/electron-builder/cli.js --win nsis --config.directories.output=release/xingyue-v7
```

当时用于整理性能证据的 `finalize-v7-evidence.mjs` 已于 2026-10-30 退役；历史结果保留在 `xingyue-v7-performance.json`。当前交付使用[脚本说明](../../scripts/README.md)中的 `verify-v7-release.mjs`，显式传入本次测试日志，不能用旧性能结果代表新版本通过验收。

首次扩展回归出现的两项失败涉及撤回队列和来源可用性失效，已修正后重跑全量。真实模型曾返回无效台账状态、遗漏人物、错误覆盖坐标与未知对话者身份；失败回执仍保留，未删掉再宣称首次成功。

## 性能

Windows 10 19045、Xeon E5-2697 v2、Node 24.11.1。主比较语料为 100/500/1000 章、30 人物、400/2000/4000 条事实和同量证据，正文分别 51,145 / 256,615 / 513,447 个 Unicode 码点。每项 4 次，以下为后 3 次中位数，毫秒。

| 章数 | 记忆查询 前 → 后 | 单人物查询 前 → 后 | 无关文件提交 前 → 后 |
| --- | ---: | ---: | ---: |
| 100 | 267.2 → 119.0 | 21.2 → 15.3 | 146.2 → 103.9 |
| 500 | 1297.2 → 455.5 | 96.7 → 47.8 | 343.5 → 135.4 |
| 1000 | 2581.5 → 898.4 | 199.9 → 116.1 | 685.2 → 179.0 |

均满足优化前记录的“不恶化超过 20%”时间门槛。1000 章查询的来源读取由 4000 次降为 1000 次；单人物查询由 136 次降为 34 次。

**哈希口径修正：**最终事实补齐了 Unicode start/end，因而与旧基线的原始 JSON hash 不同。脚本逐项验证除新增坐标外的字段完全相同；最终增量投影与完整重建包含坐标在内完全相同。不能将此写成旧、新原始 hash 一致。

1000 章的讨论上下文编译中位数 2518.3 ms、完整事实重建 3276.3 ms；进程累计峰值 RSS 451,088 KiB。扩展观测期间存储由 67,288,770 增至 67,419,842 字节。所有档位的原始冷/暖样本、来源读取、内存与存储见 JSON。

浏览器首个可交互工作台：100/500/1000 章首样本分别 942 / 1556 / 2426 ms，随后三次中位数 816 / 733 / 989 ms；停止控件完成响应 344 / 540 / 692 ms。使用真实宿主与存储、离线延迟模型；发送后取消保留 unknown，没有自动重发。这里测的是本地浏览器加载，不是冷启动 Electron；扩展指标没有事后设阈值宣称通过。

另行执行的 1200 章、300 万字重复填充容量测试：首次批量提交 43.5 s、扫描 1.15 s。它不代表真实长篇小说的因果与文学质量。

## 迁移与回退

数据库迁移保留旧对象、台账和任务，增加索引所需结构；现有数据库版本为 8。新增工作流使用显式版本绑定，缺字段的历史任务保留原有路径；不支持的执行版本保持可读并停止自动执行。旧世界迁移保留原文及来源，未解析内容不强行拆解或合并角色。

回退作品内容使用现有历史版本、撤回证据或新修订；不直接覆盖数据库或删除请求账本。索引可由正式台账完整重建。安装包输出到独立目录，保留用户既有安装和工作区；未对真实作品执行此次合成评测的写入。

## 尚需外部参与的验收

真人盲评、平台后台指标和真实百万字作品的长期语义验收尚未完成。匿名评阅页有 31 组正文；其中 29 组开发样稿为生成后登记，2 组为预登记保留样稿。1 组保留样稿长度为 631/312 字，超出目标区间，须作为长度敏感组单列，不能混入固定长度文风结论。没有剪切或重抽该失败样稿。

评阅页能离线打开，固定每位参与者的随机顺序，保留原文 hash 和码点标记，导出 JSON。演示反馈仅用于 UI 验证，不计真人。原设计案例状态保持原样；本报告按实际运行证据描述覆盖，不以 843 项总数冒充原设计每个语义 oracle 已通过。

## 临时文件清理

测试服务已停止。此前清理曾被自动审批拒绝；2026-10-29 用户再次明确要求执行后，以下两份评测早期复制的临时认证状态文件已分别通过精确路径、非递归命令删除，并确认均不再存在。用户原始认证文件未改动。

- `C:\Users\OS\AppData\Local\Temp\xingyue-eval-auth-3EEpcR\Local State`
- `C:\Users\OS\AppData\Local\Temp\xingyue-eval-auth-cevRcp\Local State`
