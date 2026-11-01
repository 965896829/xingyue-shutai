# 星月书台 · 网文写作客户端

Windows 本地创作客户端。源码版本以 [package.json](package.json) 为准；源码、安装包和本机已安装程序是不同状态，构建成功不表示已经覆盖安装。

## 当前结构

- Electron 桌面与网页管理后台共用业务服务，作品以中文目录和 Markdown 保存。
- 新任务使用 Pi 执行循环；客户端模型网关负责协议、流式响应、工具回执、预算和网络恢复。旧任务保留原执行器与检查点兼容。
- 保留 S01—S11、专项 Skill、作品方案与独立命名、分层记忆、修订影响分析、候选审核和作者采纳。
- SQLite 保存正式版本、任务和证据；模型产物先进入候选，采纳后提交正式作品。
- 模型、中转 API 与按需联网由作者配置。Embedding 检索可选；启用后会把相应资料发送到所配置的服务。

## 开发与构建

需要 Node.js 24 或支持项目依赖的兼容版本。

```powershell
npm ci
npm run dev
```

```powershell
npm run check
npm test
npm run build
npm start
```

Windows 安装包使用 `npm run dist`，输出到 `release/`；可运行目录为 `release/win-unpacked/`，其中的程序和资源需要一起保留。编译、离线回归和打包不需要模型 API Key；安装包未配置代码签名证书。

本地管理后台由客户端开启，沿用客户端授权与业务接口。开发验证应使用独立的 `WENXU_DATA_DIR` 和临时作品目录，不使用作者正在创作的作品。

如果 Electron 下载环境无法直连 GitHub，可临时配置 `ELECTRON_MIRROR`；保留下载校验和 TLS 校验。

## 代码与资料入口

| 目录 | 内容 |
| --- | --- |
| `src/core/` | 创作业务、上下文、记忆、校验、版本和模型接入 |
| `src/core/runtime/` | 执行器、模型/工具网关、检查点和恢复 |
| `src/ui/`、`src/shared/` | 桌面界面与共享类型、契约 |
| `src/admin/` | 本地网页管理后台及原后台页面适配 |
| `electron/` | 主进程、预加载和业务工作进程 |
| `resources/skill/` | 内置 Skill、标签、命名与表达规则，含完整性锁 |
| `tests/` | 自动回归、测试夹具和专项容量验证 |
| `scripts/` | 可复用开发、评估与交付工具；见[脚本说明](scripts/README.md) |
| `docs/` | 需求基线、设计、变更和历史验收记录；历史版本结论不代表当前验收状态 |

执行器接入见 [Pi 接入记录](docs/refactor/pi-integration-0.4.78.md)、[执行器能力与兼容边界](docs/refactor/executor-capability-matrix.md)。核心数据约定见[数据权威](docs/refactor/data-authority.md)与[分层记忆设计](docs/12_分层记忆与按需召回设计.md)。

0.4.96 的实际创作规则见[完整提示词清单](docs/prompts/0.4.96/README.md)，包含总控 `agent.md`、三方向与书名、S01—S11、独立审核、按需附加规则及系统提示词装配示例。示例使用默认配置，实际请求另按目标章节加入作品资料与作者要求。

[源码与目录清理记录](docs/maintenance/repository-cleanup-2026-10-30.md)说明本次退役脚本、未引用资源、旧安装包与恢复方法；更早的输出归档见 [2026-10-28 记录](docs/maintenance/repository-cleanup-2026-10-28.md)。

## 验证与边界

`npm test` 执行正式回归。`npm run test:scale`、`npm run test:large-book`、`npm run eval:context`、`npm run eval:prose` 是独立专项入口，输入和输出见[脚本说明](scripts/README.md)。真实模型验证需要明确配置和授权，不能将模拟结果当作文学质量或网络稳定性的证明。

`node scripts/check-deliverables.mjs <本次测试日志>` 核对已生成安装包、资源与测试记录；历史日志不能充当本次发布结果。第三方依赖许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)，构建时生成打包依赖许可清单。

`.test-output/`、`output/` 和 `release/` 均不属于源码。前两者可能包含作品副本、加密配置备份或验收记录，清理前应辨别内容。历史备份可移出工程保存，当前运行中的目录不应删除。
