# 脚本入口与维护范围

所有命令在项目根目录执行。`scripts/` 保存可复用的开发工具；`tests/*.test.ts` 是默认回归测试；`.test-output/` 保存运行产物和历史证据，不是自动执行的脚本入口。

## 常规开发与交付

| 脚本 | 入口 | 用途与前提 |
| --- | --- | --- |
| `dev.mjs` | `npm run dev` | 启动 Vite 和 Electron 开发环境。 |
| `build-main.mjs` | `npm run build` 间接调用 | 构建 Electron 主进程、预加载、业务进程和文档进程。 |
| `check-deliverables.mjs` | `node scripts/check-deliverables.mjs <本次测试日志>` | 检查文档、资源锁和已生成的安装包；非默认发布目录通过 `WENXU_RELEASE_DIR` 指定。每次交付显式提供本次日志，不使用脚本内的历史默认日志作为新版本证据。 |
| `generate-contract-schemas.mjs` | `node scripts/generate-contract-schemas.mjs` | 从类型生成 `src/shared/contract-shapes.json` 和 `contract-schemas.ts`；修改契约后运行，并审阅差异、执行类型检查及回归。 |
| `create-icon.mjs`、`export-brand.cjs` | `node scripts/create-icon.mjs` | 前者启动 Electron，后者使用 `nativeImage` 导出图标；二者是调用链，不是重复脚本。会更新品牌资源。 |

## 回归、专项验证与本机模拟

| 入口或脚本 | 作用 | 是否包含在 `npm test` |
| --- | --- | --- |
| `tests/*.test.ts` | 默认回归；通过测试夹具复现行为，不使用作者作品。 | 是 |
| `tests/scale.ts` / `npm run test:scale` | 1200 章、300 万字合成容量检查。 | 否 |
| `test-large-book.mjs` / `npm run test:large-book` | 分进程执行 `tests/large-book.ts` 的生成与测量；建议显式传入独立 `--output=...`，避免重用历史目录。 | 否 |
| `context-eval.ts` / `npm run eval:context` | 默认离线检查上下文；只有显式传入 `--live` 和专用配置时才请求模型。 | 否 |
| `mock-model.mjs` | 本机模拟 API，供人工界面验收；`node scripts/mock-model.mjs`。 | 否 |
| `qa-studio.ts`、`qa-studio-server.ts` | 先生成工作台合成样本，再启动配套模拟服务；保留事实、评估和阶段数据场景。依次以 `node --import tsx scripts/<文件名>` 执行。 | 否 |
| `tests/fixtures/desktop-smoke-seed.ts` | 简单桌面验收初始化，替代已移除的 `qa-desktop.ts`；`node --import tsx tests/fixtures/desktop-smoke-seed.ts`。使用隔离目录，同名样本已存在时需要先处理旧样本。 | 否 |
| `tests/fixtures/desktop-hanging-provider.ts` | 模拟不结束的流，用于退出和未知请求结果检查；与普通模拟 API 的用途不同。 | 否 |
| `tests/fixtures/management-provider.ts` | 网页管理联调夹具；`node --import tsx tests/fixtures/management-provider.ts`，默认仅监听 `127.0.0.1:9338`。提供模型列表、文字连通测试和可停止的任务流；不访问真实模型，使用独立 `WENXU_DATA_DIR` 和临时作品。 | 否 |
| `tests/fixtures/tag-ui-server.ts` | 标签界面专用的本机服务，使用真实 Service 和合成模型结果。可设 `CREATION_UI_SCENARIO` 为 `connection_error`（首次请求失败及一般审核建议）、`unknown_request`（费用未知）、`blocking_review`（审核仍有冲突）或 `title_error`（命名中断），复验分步流程与恢复。 | 否 |
| `tests/profile-large-book.ts` | 定位大数据样本各打开阶段耗时，须显式传入隔离样本路径；保留已有性能报告的复现入口。 | 否 |

## 依赖历史基线的专项工具

以下四个脚本仍被重构证据引用，因此保留。它们依赖 `.test-output/refactor/baseline*` 等本机历史材料，不属于新环境必跑的回归，也不能直接作为任意后续版本的发布门槛。

| 脚本 | 独立用途 |
| --- | --- |
| `refactor-baseline.mjs` | 按历史文件哈希，从指定安装包源码映射提取匹配的基线源码；不能将新版本安装包当作旧基线。 |
| `refactor-audit.mjs` | 检查那次重构约定的界面、注释、资源及打包边界；后续有意修改界面时，历史比较失败不等于当前功能回归。 |
| `refactor-benchmark.ts` | `baseline` / `current` 模式下测量打开、检索、会话、提交和备份等指标。 |
| `refactor-commit-benchmark.ts` | 基线与当前实现交替运行 51 对提交样本，用于提交耗时长尾对照，不等同于上一脚本的常规计时。 |

运行这些工具前核对输入和输出位置；部分工具会覆盖 `docs/refactor/` 下的历史报告。

## 2026-10-13 清理记录与后续规则

本次移除 20 个脚本，逐文件原因、原路径和 SHA-256 记录在 [清理清单](../.test-output/script-cleanup-20261013/manifest.json)，原内容保存于 [恢复归档](../.test-output/script-cleanup-20261013/retired-scripts.zip)。这些归档仅存在于本机，受 `.gitignore` 排除，不属于项目运行依赖。

- 移除 `qa-desktop.ts`、写死个人作品路径的 `verify-legacy.ts`、固定 0.1.0 文档内容的 `update-implementation-status.mjs`，以及 `_audit/` 中四个旧源项目审计和文档生成脚本。
- 移除 10 个已完成的临时补丁或升级准备脚本、2 个保留了 TypeScript 源文件的重复编译产物，以及 1 个已执行完毕的历史清理程序。
- 保留全部正式回归、业务源码、资源、升级备份、历史报告，以及用途不同的专项验证工具。
- 恢复时只从归档取出需要的文件并核对清单哈希；不要直接执行历史源码替换或清理脚本。

新增可复用工具应登记入口、输入、输出和执行条件；真实缺陷的行为验证放入 `tests/*.test.ts`。一次性代码替换脚本完成后退出工作目录。历史日志、截图和源码备份不能按脚本重名直接删除。

## 2026-10-21 生成文件清理

本轮清理旧构建、已结束的隔离测试环境、自动回归生成的样本和浏览器临时记录，清单及核对结果保存在 `.test-output/workspace-cleanup-20261021/`。保留源码、全部正式回归、依赖、作品与配置备份、历史报告、重构基线，以及 0.4.29 的验收证据。

- 当前完整构建：`.release/lock-recovery-0.4.29/`；上一版回退安装包：`.release/real-client-e2e-0.4.28/`。已删除更旧的构建和上一版重复的展开目录。`.release/` 与 `release/` 均排除在 Git 之外。
- `.test-output/refactor/fixtures/`、`.test-output/chat-controls-tests/`、`.test-output/task-discussion-tests/` 是自动测试生成的合成样本，测试运行时会重新创建。确认测试进程结束后可以清理；`tests/fixtures/` 中的夹具源码仍需保留。
- `.test-output/` 同时存有升级备份和验收证据，不能把整个目录当作缓存清空。包含作者作品或配置的历史备份本轮未删除。
- 发布检查必须显式传入本次测试日志；省略参数会停止检查，不再默认读取旧的标签升级日志。交付报告里的测试结果对应所传入的日志，不表示检查时重新运行了测试。

本次一次性清理脚本执行后移除，目录中只保留清单、删除日志和核对结果。
