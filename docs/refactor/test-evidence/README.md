# 验收记录索引

工作树基点 ade3d5c；Windows10 19045、Node24.11.1、Electron44.6.0。测试目录为 .test-output/refactor/fixtures、隔离 userData 和临时合成作品。正式生产安装、作品和密钥未作为夹具。

| 命令/方式 | 结果文件 | 用途 |
|---|---|---|
| npm run check | check-final.log | 严格类型检查 |
| npm test | test-final.log | 全部原回归和新增故障/契约测试；以日志末尾数量为准 |
| npm run build | build-final.log | TypeScript、Vite、Electron三入口 |
| npx electron-builder --win nsis --config.directories.output=release/refactor | package-final.log | Windows x64 NSIS/ASAR |
| npx tsx scripts/refactor-benchmark.ts baseline/current | ../performance/*.json | 同机100文档/百万字符/万条会话 |
| node --import tsx scripts/refactor-commit-benchmark.ts | ../performance/commit-paired.json | 提交长尾疑点：5次预热、51对交替复测，保留全部样本 |
| npm run test:scale | scale-final.json | 1200章/300万字容量，不能与最初并行基线直接算加速 |
| node scripts/refactor-audit.mjs | source-audit.json | UI骨架、资源字节、无新增注释和生产无Pi |
| npm audit --omit=dev --json | audit-production.json | 生产依赖审计；不是开发全树审计 |
| 全局Playwright MCP连接真实Electron CDP | desktop-smoke.json、forced-recovery.json | 实包页面、取消/恢复、编辑保护、诊断版本 |
| 最终ASAR再次打开并安全退出 | final-package-smoke.json、final-cleanup.json | 0.4.1、两条unknown、脏编辑、请求数2和锁释放 |
| 精确校验父PID和exe后终止/挂起隔离worker | worker-kill.json、forced-close.json | 真实进程恢复/退出15秒上限 |
| 正常关闭活动请求窗口 | graceful-close.json | writer/管理仓库锁全部释放 |
| 源码类型反例 | tests/refactor-boundaries.test.ts | 4种非法调用编译失败，不使用ts-expect-error注释 |

详细T-001—070映射见 acceptance-matrix.md。截图由Playwright渲染器截图获取；未使用Windows10不兼容的原生截图接口。

最初门禁失败和修复前日志保留在 .test-output/refactor（p01-red、gateway、boundary等），不把调试失败计入最终通过。故障注入和真实磁盘占用分别标注；没有真实断电、填满磁盘、签名或覆盖安装证明。

最后一次全量回归190/190通过，202067ms。随后仅将备份pending清单移到备份目录之外以避免与作者同名文件冲突，定向回归1/1通过（backup-final.log），最终build再次包含类型检查。大规模容量测试与当时NSIS打包存在重叠，只作容量证据；性能阈值对比另在打包结束后独立重跑。current-contended-discarded.json保留争用样本但不用于对比。
