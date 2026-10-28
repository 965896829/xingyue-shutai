# 2026-10-28 源码与目录清理

## 审查结论

本次按入口、引用和实际文件内容清理，不以“旧版本”或“测试”作为删除依据。审查时工作树包含未提交修改，且另一项任务正在更新 0.4.81；本次没有改动版本号、依赖、作者作品或安装程序。

对 430 个 TypeScript/JavaScript 文件进行模块引用分析，覆盖桌面、网页后台、Electron、脚本和测试。在检查的业务入口范围内，没有发现完全脱离入口的业务源码文件，也未发现明显无引用的生产依赖。TypeScript 已启用未使用局部变量及参数检查。静态分析不能证明每条业务分支都实际执行，因此未把仅凭命名或低使用频率怀疑的代码删除。

主要冗余来自三处：绑定旧版本的一次性验收脚本、重复品牌图片，以及长期留在工程内的历史输出和安装包。正式回归、Pi 执行器、旧任务执行器、数据迁移和恢复逻辑仍有当前用途，予以保留。

## 已移除与修正

| 范围 | 处理 | 依据 |
| --- | --- | --- |
| 4 个历史重构工具 | 删除 `scripts/refactor-baseline.mjs`、`refactor-audit.mjs`、`refactor-benchmark.ts`、`refactor-commit-benchmark.ts` | 依赖固定历史基线、旧本机目录或旧打包要求；例如禁止生产包包含 Pi 的条件与当前架构不符；不是 npm 入口 |
| 15 个历史验收脚本 | 删除下表所列脚本，保留对应报告 | 固定旧界面、端口和临时目录，只适用于当时版本；不是当前自动回归入口 |
| 3 张重复图片 | 删除 `public/icon.png`、`resources/icon.png`、`public/brand/wordmark-night.png` | 与保留的 `public/brand/app-icon.png`、`wordmark-day.png` 分别逐字节一致；同步修改品牌导出器、导出清单和预加载列表 |
| 未使用接口 | 删除 `src/shared/assistant.ts` 的 `KnowledgeProvider` 预留接口 | 无实现、无调用；不影响当前知识检索和记忆模块 |
| 容量分析工具 | `profile-large-book.ts` 必须传入存在的样本；`large-book.ts` 默认目录改为 `.test-output/large-book` | 去掉固定历史日期路径；缺少样本时先退出，不创建空数据库 |
| 使用文档 | 更新根 README、脚本说明与历史报告提示 | 去掉过时的当前版本、安装路径和已退役执行入口；保留历史结论的时间边界 |

历史脚本清单：

| 目录 | 已删除文件 |
| --- | --- |
| `docs/refactor/optimization-evidence/` | `dialog-fixture.js`、`electron-benchmark.js`、`main-inspector.mjs` |
| `docs/refactor/planning-language-evidence/` | `seed.ts`、`verify.ts` |
| `docs/refactor/simple-start-evidence/` | `audit.mjs`、`desktop-fixture.ts`、`failure-playwright.js`、`happy-playwright.js`、`noModel-playwright.js`、`reopen-playwright.js`、`select-test-directory.mjs`、`tag-playwright.js` |
| `docs/refactor/workflow-evidence/` | `audit.mjs`、`desktop-fixture.ts` |

本次没有删除 `tests/*.test.ts`。持续验证失败恢复、版本一致性和旧作品兼容的测试不属于一次性脚本。

## 本机输出处理

- 将 **615 个历史条目、59,376 个文件，共 4,182,990,923 字节（约 3.90 GiB）** 移到项目外。它们来自 `.test-output/`、`output/` 及旧分析目录，包含历史日志、样本、作品副本和配置备份。归档不会释放同等磁盘空间。
- 删除 `release/` 内 **0.4.73—0.4.79 的 7 组安装包与 blockmap，共 14 个文件、889,014,331 字节（约 848 MiB）**。保留清理时的 0.4.81、前一版 0.4.80 和 `win-unpacked/`。记录旧包哈希，并将两处旧包文档链接改为历史文件名说明。
- 保留当天修改、运行中进程使用、包含链接目录或仍被文档链接引用的输出。历史文档引用的证据未整体删除；当前构建与正在执行的测试目录未清空。
- 没有访问或改写作者在工程外的正式作品，也未改动模型密钥、Sub2API 配置或本机已安装程序。

本机归档位于 `D:\AIkehuduan-archives\cleanup-20261028-104858`，不属于源码发布内容：

| 文件或目录 | 用途 |
| --- | --- |
| `pre-cleanup-working-tree.patch`、`pre-cleanup-status.txt` | 清理前已有修改的记录；不要直接覆盖当前工作树 |
| `before/`、`source-backup-manifest.json`、`extra-source-backup-manifest.json` | 本次改删文件的原始副本与哈希 |
| `historical-output/`、`archive-moves.jsonl` | 历史输出与逐项原位置、归档位置映射 |

恢复时先查清单，再将需要的单个文件或目录复制回原位置；若原位置已生成新文件，先比较，不覆盖。目录移动前后核对文件清单、相对路径、大小及修改时间的摘要；单文件移动和源码备份另核对内容 SHA-256。归档没有去重或删除备份内容。

## 保留的兼容与维护边界

- 当前 Pi 运行循环及旧执行器均有用途；旧执行器仍用于历史任务恢复。
- S01—S11、旧作品迁移、正式版本事务、候选审核和恢复检查保留。
- Skill 的运行时资源与参考资料存在用途不同的副本，受资源锁与加载路径约束，未按字节相同直接合并。
- 原网页后台页面按已有产品要求保留；尚未接入的页面不能仅凭暂时无业务调用删除。
- 当前构建脚本、正式测试、可复用联调夹具、依赖及许可文件保留。

新工具应有明确入口、输入和输出；回归断言放入 `tests/*.test.ts`。历史报告只说明对应版本，不作为当前版本发布证据。输出目录可能含备份，后续清理仍应先辨别内容。

## 验证

验证记录保存在本机 `.test-output/repository-cleanup-20261028/`。本次没有请求真实模型或覆盖安装。

- `npm run check`：通过。
- Vite 桌面及管理后台构建：通过，输出到隔离目录；仍有现有的大 chunk 提示。
- Electron 四个入口按生产配置打包及外部依赖检查：通过，输出到隔离目录；未改写共享 `dist` 或安装包。本次不重跑完整安装包及许可交付流程。
- 品牌清单 12 个保留文件哈希、3 个重复图片的内容一致性、导出脚本语法：通过。
- 容量分析工具缺参数、样本不存在的退出行为：通过，未创建样本数据库。
- 全量回归：`node --import tsx --test --test-concurrency=2 --test-reporter=tap tests/*.test.ts`，**809/809 通过**，无失败、跳过或取消。本次显式使用两个测试文件并发；项目默认 `npm test` 命令未修改。
- 最终引用检查：删除项无源码残余引用，更新文档无失效本地链接；核对原有 224 个受保护路径，除明确退役并去除链接的旧安装包外均存在。
- `git diff --check`：本次修改范围内通过。
