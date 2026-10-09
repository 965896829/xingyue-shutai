# GitHub 架构调研与取舍

查询日期：2026-10-06。比较依据是公开仓库的固定提交、依赖清单、README 与选定执行路径；没有安装运行这些客户端，也没有比较生成质量、速度或市场表现。星数与作者宣传不是本报告的质量证据。

## 1. 固定版本和技术构成

| 项目 | 本次固定提交 | 已核对的技术构成 | 与本需求的关系 |
| --- | --- | --- | --- |
| newesp/novel-generator | 88d5e028a9c478f18d2d8d4e99721781d1a8f317 | React、TypeScript、Vite、Mantine、Zustand；Tauri 2；桌面 SQLite / Web IndexedDB 存储适配 | 中文小说创作面板和跨存储接口可参考；存储方式不满足用户“MD 直接编辑”即需改造 |
| Feed-Scription/openovel | 1b4404e85d03d1e41e5d745e303372333b29c610 | Electron、React、CodeMirror、Node；工具循环与普通文件资料 | 文件工作区和叙事/后台任务分离适合参考；主要是互动叙事，不等于本 Skill 的批次写作 |
| devlikebear/linetta | 34cf973d8ca15f32d5473181f6a381d0835596ec | Tauri 2/Rust、React/TS、TipTap、嵌入式 Go 引擎、SQLite、MCP | 写作编辑、版本和外部 AI 接口有价值；多语言及数据库事实来源增加迁移成本 |
| shenminglinyi/PlotPilot | cbd260ba7b5fe35e53f528937c4a240fb67ea2dc | Vue/TS、Tauri/Rust、Python/FastAPI；复杂生成/记忆/预算流水线 | 与已有调研快照一致，适合学习模块拆分；不适合假定整套可靠后直接照搬 |

依赖依据：[novel-generator package.json](https://github.com/newesp/novel-generator/blob/88d5e028a9c478f18d2d8d4e99721781d1a8f317/package.json)、[openovel package.json](https://github.com/Feed-Scription/openovel/blob/1b4404e85d03d1e41e5d745e303372333b29c610/package.json)、[Linetta desktop package](https://github.com/devlikebear/linetta/blob/34cf973d8ca15f32d5473181f6a381d0835596ec/apps/desktop/package.json)、[Linetta Go 依赖](https://github.com/devlikebear/linetta/blob/34cf973d8ca15f32d5473181f6a381d0835596ec/engine/go.mod)、[PlotPilot frontend package](https://github.com/shenminglinyi/PlotPilot/blob/cbd260ba7b5fe35e53f528937c4a240fb67ea2dc/frontend/package.json)。

## 2. novel-generator：功能接近，但不应照搬存储

README 描述了分层规划与写作、角色/世界/伏笔、供应商配置和可选多角色协作；部分模块仍列为未完成，因此不能按功能目录就认定全部可用。其桌面与 Web 使用不同底层存储，通过适配接口隔离差异，这个抽象值得参考。[README](https://github.com/newesp/novel-generator/blob/88d5e028a9c478f18d2d8d4e99721781d1a8f317/README.md)

对本项目的推论：可借鉴“领域接口不依赖 UI”和分层规划；用户明确要求外部编辑 Markdown，故不能直接采用数据库为唯一事实来源。其许可证文件明确为 AGPL-3.0-only，不能因为仓库元数据显示不确定就当成无约束代码。[LICENSE](https://github.com/newesp/novel-generator/blob/88d5e028a9c478f18d2d8d4e99721781d1a8f317/LICENSE)

## 3. openovel：最值得看的文件工具循环

其 README 描述前台叙事与后台常驻任务分别运行，资料保存为普通 Markdown/JSON；默认不把向量库或图数据库设为前提。它更偏互动小说，README 也说明 Windows 测试程度较轻，不能据此保证本机运行体验。[README](https://github.com/Feed-Scription/openovel/blob/1b4404e85d03d1e41e5d745e303372333b29c610/README.md)

工具循环有步数上限、工具注册、结果回填与历史压缩，可借鉴有界执行，不能只复制模型提示。[toolLoop.js](https://github.com/Feed-Scription/openovel/blob/1b4404e85d03d1e41e5d745e303372333b29c610/src/runtime/toolLoop.js)

文件事务代码保存 before/after 和 manifest，但异常主要记录状态，恢复分支可标记 abandoned；回滚复制文件的逻辑不能自动证明具有外部编辑冲突保护。这支持“保存变更日志”的设计，不支持“现成事务已经保证绝不丢稿”的结论。[storyTransaction.js](https://github.com/Feed-Scription/openovel/blob/1b4404e85d03d1e41e5d745e303372333b29c610/src/runtime/storyTransaction.js)

许可证为 Apache-2.0；即使较适合工程复用，也应确认具体文件来源和保留必要许可信息。[LICENSE](https://github.com/Feed-Scription/openovel/blob/1b4404e85d03d1e41e5d745e303372333b29c610/LICENSE)

## 4. Linetta：作者工作台与执行接口分层

README 与依赖文件显示，桌面壳和嵌入式 Go 引擎通过 C ABI 上的 JSON-RPC 信封通信；有本地 SQLite、写作编辑、快照/备份及 AI/MCP 接口。它不是“一个网页套壳加提示词”。README 对结构撤销和持久快照作了区分，提示我们不要混淆编辑撤销与崩溃恢复。[README](https://github.com/devlikebear/linetta/blob/34cf973d8ca15f32d5473181f6a381d0835596ec/README.md)

对本项目的推论：可借鉴同一业务内核同时服务 UI 与 AI 工具、来源活动记录和版本恢复；不必引入 Go、Rust、TS 三门语言来获得这些特性。许可证为 AGPL-3.0-only，另有商业许可入口。AGPL 不能简单理解成“禁止收费”：该项目许可说明明确提到付费构建和服务；需要核对的是你的复用、分发及源码提供方式是否符合许可，不能默认闭源搬用。[许可说明](https://github.com/devlikebear/linetta/blob/34cf973d8ca15f32d5473181f6a381d0835596ec/LICENSE-NOTICE.md)

## 5. PlotPilot：架构复杂不等于行为可靠

桌面启动路径将 Tauri 外壳与 Python 后端联动，写作委派再进入生成流水线；当前本地与线上固定提交一致。[桌面启动代码](https://github.com/shenminglinyi/PlotPilot/blob/cbd260ba7b5fe35e53f528937c4a240fb67ea2dc/frontend/src-tauri/src/lib.rs)、[写作委派](https://github.com/shenminglinyi/PlotPilot/blob/cbd260ba7b5fe35e53f528937c4a240fb67ea2dc/engine/runtime/writing_delegate.py)

可借鉴分层上下文、角色投影、章后管线、尝试与采纳分离；本次隔离探针发现的预算溢出与构造参数问题见 [源码审计](02_源码与档案审计.md) 和 [探针结果](../analysis-2026-10-06/plotpilot-probes.json)。没有启动全系统，不将局部缺陷扩展成对全部功能的否定。

许可证是带 Commons Clause 的 Apache 2.0 文本，不能按普通 Apache 项目处理收费复用。用户明确未来存在收费功能，因此本项目建议参考设计并独立实现，复制代码需另行明确授权。[固定许可证](https://github.com/shenminglinyi/PlotPilot/blob/cbd260ba7b5fe35e53f528937c4a240fb67ea2dc/LICENSE)

## 6. Codex：参考执行模型，不把名称当需求

已检查本机 `@openai/codex` 包与官方文档。App Server 面向客户端提供线程、轮次、事件和交互；SDK 适合以代码调用。自定义 provider 配置能提供基址，但这不能证明任意兼容中转都支持完整执行协议。[App Server](https://developers.openai.com/codex/app-server)、[SDK](https://developers.openai.com/codex/sdk)、[高级配置](https://developers.openai.com/codex/config-advanced)

你的真实要求是可读资料、调用工具、展示改动、阶段批准、中断续跑。这些可以由自建 Runner 实现，也可以在协议条件满足时通过 App Server 实现。用户已经允许自建内核，因此不应为了“像 Codex”牺牲多供应商能力。

## 7. 最终取舍

推荐 Electron 是基于当前项目复杂度、既有 TSX 背景和减少运行时种类的判断，**不是从几个仓库推导出它在所有方面优于 Tauri**。Tauri 项目证明了其可行性，Electron 项目证明了文件型工具执行的另一条路线；真正需要验证的是作者的目标机器、MD 外部编辑、长篇状态与真实 API。

优先学习的内容依次是：openovel 的文件与工具边界、现有网站的协议和未知请求处理、原 Skill 的领域规则、Linetta 的作者工作台/版本区分、PlotPilot 的记忆问题分解。所有参考都要通过自己的验收矩阵。

不根据 README 接受“降低多少 token”“不会崩书”“一键爆款”等未经本次测试的数据。所有引用固定到提交，未来仓库变化不会悄悄改写本次结论。
