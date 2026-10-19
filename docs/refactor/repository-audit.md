# 仓库审计

审计日期：2026-10-10；工作目录 D:\AIkehuduan。起点 HEAD ade3d5c，分支 codex/agent-kit-integration。起点已经存在大量用户未提交改动，包括品牌、标签功能、主题、退出窗口、资源和测试；本轮没有 reset、清理这些文件、提交或推送。

用户明确要求保持 UI、不添加代码注释。本轮只改变渲染端数据读取、契约、分页、会话和编辑保护；优先于方案中新增状态界面的描述。原方案原文保存为 plan.md；提及的 sources/ORIGINAL_ARCHITECTURE.txt 和 SOURCE_MAP.md 没有随文件提供，未把引用行号当作本仓库证据。

## 实际环境与基线

- Windows 10 19045，Node 24.11.1，npm 11.6.2，Electron 44.6.0，TypeScript 5.9.3，Zod 4.6.5，React 19.3.0。
- Electron 主进程负责窗口、系统对话框和加密配置；utilityProcess 中运行 Service、SQLite 和领域执行器；React 渲染器 sandbox/contextIsolation 保持开启。
- SQLite WAL + synchronous=FULL；原数据库 user_version=3；正式提交原已有 changeset、对象仓库、journal、outbox，采用封装和加固，没有另建第二套正式数据。
- npm run check、npm test、npm run test:scale 在改造前重新执行。基线143/143通过，耗时142774 ms。原始记录在 .test-output/refactor/baseline；不是引用旧文档的143项结论。
- 原工作树源码65份从既有未修改的 release/win-unpacked/resources/app.asar 源映射提取，并逐文件与本次改造前 SHA256 完全匹配后才作为基线。见 performance/baseline-source.json。
- 同机性能基线与改后测量独立运行，不与全量测试并行。最初1200章压力测试与其他测试并行，只证明容量，不作为速度提升依据。

## BASE-01—09

| 项目 | 真实发现与处理 |
|---|---|
| BASE-01 | 复现结构版本2回收站不兼容；共享 compatibility.ts，覆盖打开、回收和恢复 |
| BASE-02 | 复现策划恢复不支持 instruction；resumeArguments 按能力构造，后台仍拒绝伪造 |
| BASE-03 | 复现诊断硬编码旧版本；build.ts 从 package.json 提取，实包验证0.4.1 |
| BASE-04 | 原99命令泛型由调用者指定；现106命令同源输入/输出校验，负类型测试4种编译失败 |
| BASE-05 | 增加 pending 超时/取消/迟到处理及可查 operationId；取消信号不跨 contextBridge |
| BASE-06 | 保留业务 Run 投影，集中状态校验与版本竞争；另增终结不可复活的 execution_records |
| BASE-07 | 有限重启、版本握手、最多15秒退出；实包杀 worker 和挂起 worker 后关闭已测 |
| BASE-08 | 资源查询、稳定游标、watcher 合并提示和60秒兜底；保留快照纠偏 |
| BASE-09 | 明确数据库正式权威、文件外部变更、派生索引；保留旧候选、对象、迁移备份 |

## 保护范围

测试只使用临时或 .test-output/refactor 下合成作品。真实已安装的 D:\aiwenxu\wenxu-desktop\星月书台.exe、其进程和用户配置未替换或关闭。安装包输出到 release/refactor，保留旧 release 产物。appId、NSIS GUID、原 userData 名称均保留。

原环境继承 NODE_TLS_REJECT_UNAUTHORIZED=0；生产 main/worker 显式设为1，网络安装/审计命令显式恢复校验。没有为依赖下载关闭证书验证。
