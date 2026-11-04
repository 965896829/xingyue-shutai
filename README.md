# 星月书台 · 网文写作客户端

Windows 本地创作客户端。源码版本以 [package.json](package.json) 为准；源码、安装包和本机已安装程序是不同状态，构建成功不表示已经覆盖安装。

## 当前结构

- Electron 桌面与网页管理后台共用业务服务，作品以中文目录和 Markdown 保存。
- 新任务使用 Pi 执行循环；客户端模型网关负责协议、流式响应、工具回执、预算和网络恢复。旧任务保留原执行器与检查点兼容。
- 保留 S01—S11、专项 Skill、作品方案与独立命名、分层记忆、修订影响分析、候选审核和作者采纳。
- SQLite 保存正式版本、任务和证据；模型产物先进入候选，采纳后提交正式作品。
- 模型、中转 API 与按需联网由作者配置。Embedding 检索可选；启用后会把相应资料发送到所配置的服务。

## 自由创作实验室

首页和侧栏可直接进入，不需要先打开正式作品。输入题材或一句创意后，以一次流式请求生成 Markdown 构想；随后可以自由讨论、选择原文做局部修改、保存手改候选、选定版本、添加保留点和试写正文。17 项构想目录只用于组织与导航。

实验室只读取已配置的模型连接，每次请求捕获配置快照；会话、版本、请求账本及导出文件保存在应用数据目录的 `story-lab/`。它不读取当前作品资料，不推进 S01—S11，不向正式作品采纳或同步。提示词仅使用 `resources/skill/story-lab/` 的独立资源，正文试写才加载 `prose.md`。

实验室的 Responses 请求从首次发送即使用 HTTP/SSE，避免本机中转的上游 WebSocket 在长时间无事件时断开；全局连接配置和正式任务的传输方式保持不变。请求记录显示实际传输、等待上限及脱敏连接诊断。发生中断仍保留未知结果与费用，不自动切换协议重发。

每次操作最多发送 1 次模型请求，无自动重试、联网、工具调用或审核链。输出截断后可主动继续；远端结果或费用未知时会保留已有内容并要求明确确认新请求。手改与模型回复都保存为候选，选择较旧候选前须比较版本。资料过大时停止发送，不静默删除作者要求。可导出 Markdown/文本；隐藏入口保留数据，可从侧栏重新启用。

隔离回归：`node --import tsx --test tests/story-lab.test.ts`。真实模型对照脚本见 [scripts/story-lab-eval.ts](scripts/story-lab-eval.ts)，只在显式传入 `--authorized-story-lab-comparison` 后运行；最多 7 次调用，包含一句需求、实验室、正式 S01 首阶段及相同场景资料的两组正文。正式 S01 不代表完整 S01—S11 产出，单次对照不能证明稳定的文学质量优势。

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
