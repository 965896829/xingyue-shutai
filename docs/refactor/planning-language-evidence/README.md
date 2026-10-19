# 0.4.3 验证证据

日期：2026-10-11。全部桌面验证使用隔离配置与合成作品，未发起真实模型请求；结果不等于真实模型输出质量或覆盖安装验收。

| 文件 | 内容 |
|---|---|
| `tests.log` | 最终完整回归206项 |
| `targeted-tests.log` | 开发中的21项定向回归；最终结果以完整回归为准 |
| `build.log`、`package.log` | 类型检查、构建与NSIS打包 |
| `source-audit.json`、`review.json` | UI、资源、注释、依赖与包内容核对 |
| `electron-smoke.json` | 实际客户端候选与约束变化显示、底层原文 |
| `fixture.json`、`cleanup.json` | 合成样本身份与前后记录指纹、退出释放 |
| `delivery-report.json` | 资源清单、测试日志及安装包哈希 |
| `seed.ts`、`verify.ts` | 本轮隔离样本和完整性核对源码留档 |

可在项目根执行 `npm test`、`npm run build`。打包执行 `npx electron-builder --win nsis --config.directories.output=release/planning-language`。在PowerShell设置 `WENXU_RELEASE_DIR=release/planning-language` 后执行 `node scripts/check-deliverables.mjs .test-output/planning-language-20261011/tests.log`；源码审计使用 `scripts/refactor-audit.mjs`，并将 `WENXU_AUDIT_OUTPUT` 指向新证据路径。

留档脚本的相对导入以原执行位置 `.test-output/planning-language-20261011/` 为基准，需复制回该位置才可复测；`seed.ts` 应在新的空隔离目录运行，不能指向真实作品或覆盖既有验证目录。截图在 `output/playwright/planning-language-0.4.3.png`。静态证据中的路径仅标识本次合成数据。
