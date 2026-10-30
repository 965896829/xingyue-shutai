# 脚本入口与维护范围

所有命令在项目根目录执行。`scripts/` 保存可复用的开发工具；`tests/*.test.ts` 是默认回归测试；`.test-output/` 保存运行产物和历史证据，不是自动执行的脚本入口。

## 常规开发与交付

| 脚本 | 入口 | 用途与前提 |
| --- | --- | --- |
| `dev.mjs` | `npm run dev` | 启动 Vite 和 Electron 开发环境。 |
| `build-main.mjs` | `npm run build` 间接调用 | 构建 Electron 主进程、预加载、业务进程和文档进程。 |
| `bundle-dependencies.mjs` | `build-main.mjs` 调用 | 核对生成代码只外部引用 Node/Electron，保留打包输入及生产依赖树的许可到 `dist/third-party-licenses`。安装包排除重复 `node_modules`；若增加外部依赖，构建先失败，须重新验证打包边界。 |
| `check-deliverables.mjs` | `node scripts/check-deliverables.mjs <本次测试日志>` | 检查文档、资源锁和已生成的安装包；非默认发布目录通过 `WENXU_RELEASE_DIR` 指定。每次交付显式提供本次日志，不使用脚本内的历史默认日志作为新版本证据。 |
| `verify-v7-release.mjs` | `node scripts/verify-v7-release.mjs <本次测试日志>` | 核对 `release/xingyue-v7` 中的版本、前端、Electron 程序及全部 Skill 资源，生成带版本号的交付清单。显式提供本次日志；脚本将显式日志标为专项范围，不能据此宣称全量回归。保留既有付费调用账本，不调用模型。 |
| `generate-contract-schemas.mjs` | `node scripts/generate-contract-schemas.mjs` | 从类型生成 `src/shared/contract-shapes.json` 和 `contract-schemas.ts`；修改契约后运行，并审阅差异、执行类型检查及回归。 |
| `create-icon.mjs`、`export-brand.cjs` | `node scripts/create-icon.mjs` | 前者启动 Electron，后者使用 `nativeImage` 导出图标；二者是调用链，不是重复脚本。会更新品牌资源。 |

## 回归、专项验证与本机模拟

| 入口或脚本 | 作用 | 是否包含在 `npm test` |
| --- | --- | --- |
| `tests/*.test.ts` | 默认回归；通过测试夹具复现行为，不使用作者作品。 | 是 |
| `tests/scale.ts` / `npm run test:scale` | 1200 章、300 万字合成容量检查。 | 否 |
| `test-large-book.mjs` / `npm run test:large-book` | 分进程执行 `tests/large-book.ts` 的生成与测量；建议显式传入独立 `--output=...`，避免重用历史目录。 | 否 |
| `prose-eval.ts` / `npm run eval:prose` | 离线检查正文评估夹具与质量指标；输出到独立评估目录。 | 否 |
| `context-eval.ts` / `npm run eval:context` | 默认离线检查上下文；只有显式传入 `--live` 和专用配置时才请求模型。 | 否 |
| `mock-model.mjs` | 本机模拟 API，供人工界面验收；`node scripts/mock-model.mjs`。 | 否 |
| `run-skill-parity.ts` | 已获作者授权时的真实模型流程复测。用 esbuild 打包为 CJS 后由 Electron 执行，传入 `--harness-config=<JSON绝对路径>`；配置指定独立作品/记录目录、Skill 根、原始输入、模型编号及现有加密设置文件。通过同一 Service/runner/provider 生成，候选停下等待 `control.json` 审阅决定；保存完整请求、输出和阶段时间。密钥只在内存解密，分享记录时排除 `electron-profile`。 | 否 |
| `qa-studio.ts`、`qa-studio-server.ts` | 先生成工作台合成样本，再启动配套模拟服务；保留事实、评估和阶段数据场景。依次以 `node --import tsx scripts/<文件名>` 执行。 | 否 |
| `tests/fixtures/desktop-smoke-seed.ts` | 简单桌面验收初始化，替代已移除的 `qa-desktop.ts`；`node --import tsx tests/fixtures/desktop-smoke-seed.ts`。使用隔离目录，同名样本已存在时需要先处理旧样本。 | 否 |
| `tests/fixtures/desktop-hanging-provider.ts` | 模拟不结束的流，用于退出和未知请求结果检查；与普通模拟 API 的用途不同。 | 否 |
| `tests/fixtures/management-provider.ts` | 网页管理联调夹具；`node --import tsx tests/fixtures/management-provider.ts`，默认仅监听 `127.0.0.1:9338`。提供模型列表、文字连通测试和可停止的任务流；不访问真实模型，使用独立 `WENXU_DATA_DIR` 和临时作品。 | 否 |
| `tests/fixtures/tag-ui-server.ts` | 标签界面专用的本机服务，使用真实 Service 和合成模型结果。可设 `CREATION_UI_SCENARIO` 为 `connection_error`（首次请求失败及一般审核建议）、`unknown_request`（费用未知）、`blocking_review`（审核仍有冲突）或 `title_error`（命名中断），复验分步流程与恢复。 | 否 |
| `tests/profile-large-book.ts` | 定位大数据样本各打开阶段耗时，须显式传入已存在的隔离容量样本路径；未提供路径时退出，不再默认访问旧日期目录。 | 否 |

## 维护与清理

- 只把可复用、说明了输入输出的工具放入 `scripts/`；回归断言放入 `tests/*.test.ts`，合成输入放入 `tests/fixtures/`。
- `refactor-baseline.mjs`、`refactor-audit.mjs`、两份 `refactor-*-benchmark.ts` 及 `docs/refactor/*-evidence/` 中的一次性执行脚本已于 2026-10-28 退役。它们绑定旧基线、旧界面与旧打包限制，不是当前发布门槛。对应历史报告保留。
- `finalize-v7-evidence.mjs` 已于 2026-10-30 退役。它绑定固定历史性能样本，并会覆盖当前交付清单；保留历史性能报告，当前安装包使用上表的 `verify-v7-release.mjs` 核对。
- 新的容量验证默认输出到 `.test-output/large-book/`；需要保留多次结果时使用 `npm run test:large-book -- --output=<独立目录>`。性能分析只对合成样本运行。
- 构建产物、日志、截图和临时模型响应放在忽略目录中。包含作者作品或配置的备份先归档，不整目录清空。
- 历史输出移到项目外后，原路径到归档位置的对应关系记录在本机 `.test-output/repository-cleanup-20261028/`。源码与详细原因见[清理记录](../docs/maintenance/repository-cleanup-2026-10-28.md)。
- 本次无引用代码、资源及旧安装包的处理见 [2026-10-30 清理记录](../docs/maintenance/repository-cleanup-2026-10-30.md)。
