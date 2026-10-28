# 0.4.2 优化证据

> 历史验收记录：本文保存的是当时的结果和命令，不代表当前版本通过验收。其中依赖旧界面、旧基线的一次性脚本已退役；当前入口与归档说明见 [2026-10-28 清理记录](../../maintenance/repository-cleanup-2026-10-28.md)。

报告见 [文档导入优化记录](../optimization-0.4.2.md)。这些文件保留2026-10-10本机验证结果，未覆盖作者真实安装。旧0.4.1证据继续位于相邻test-evidence目录。

| 文件 | 内容 |
|---|---|
| `tests.log` | 最终197/197回归，包含新增7项解析线程测试 |
| `build.log`、`package.log` | TypeScript检查、Vite、四入口bundle、NSIS构建 |
| `source-audit.json`、`review.json` | UI/资源/源码注释/包核对，以及本轮辅助代码、依赖和存储基线核对 |
| `baseline-files.json` | 开始优化时的主要源码SHA256 |
| `import-before.json`、`import-after.json` | Node直接解析/独立线程4次原始样本 |
| `electron-before.json`、`electron-after.json` | 真实0.4.1/0.4.2展开包各3次并发查询和导入结果 |
| `electron-benchmark.js` | 通过全局Playwright MCP执行的同一段测量代码 |
| `main-inspector.mjs`、`dialog-fixture.js` | 仅在指定隔离userData测试进程替代原生选择框返回；未写进生产包 |
| `electron-smoke.json`、`cleanup.json` | 预览和确认流程、活动导入退出、锁及源文件检查 |
| `delivery-report.json` | 安装包、资源、构建输入和测试日志hash |
| `diff-check.json`、`links.json` | 最终差异空白与文档链接检查 |

## 复测命令

在仓库根目录执行；测试输入由测试创建，不需要Key。

```powershell
node --import tsx --test tests/document-importer.test.ts
npm test
npm run build
$env:NODE_TLS_REJECT_UNAUTHORIZED='1'
npx electron-builder --win nsis --config.directories.output=release/optimization
$env:WENXU_RELEASE_DIR='release/optimization'
$env:WENXU_AUDIT_OUTPUT='.test-output/optimization-20261010/source-audit.json'
node scripts/refactor-audit.mjs
node scripts/check-deliverables.mjs .test-output/optimization-20261010/tests.log
```

实际桌面复测使用已保存的合成输入`.test-output/optimization-20261010/large.docx`和该目录内新建作品。输入hash和长度见结果JSON。选择框测试桩严格校验`WENXU_DATA_DIR`为该目录的`electron 用户 空格`，路径不符即拒绝。分别启动两个展开包，参数为`--remote-debugging-port=9327 --inspect=127.0.0.1:9328`，关闭前一个后再启动后一个；不能指向真实用户配置目录。

先通过main-inspector执行dialog-fixture，再用全局Playwright MCP打开合成作品并运行electron-benchmark.js。浏览器连接在finally中断开；关闭测试窗口后核对测试主进程退出、项目和管理写锁消失及源文件hash。原生文件选择框的交互未在本次重新验收。

Node和Electron使用不同运行时，两个样本组分别记录。测量目标是导入期间响应性及内容一致性，单机3/4次样本不能代表所有文档和硬件，也不证明文学生成质量。
