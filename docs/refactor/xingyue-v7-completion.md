# V7 工程收尾与交付记录

最新状态见 [0.4.87 全局复核与交付](xingyue-v7-global-audit.md)。本次补齐先前遗漏的公开分类入口、多体系合同和平台样本证据；下文保留 0.4.85 的历史结果，不代表当前范围均已通过外部质量验收。

2026-10-29，版本 **0.4.85**。本次完成 0.4.84 记录中尚未接通的可视化交互，保留前两批已经完成的架构、记忆、创作工具、匿名反馈和质量证据。工程实现与本地验收已完成；真人盲评、真实长篇连续创作和平台指标仍须实际样本，不能记作已通过。

## 交付

- 历史安装包：`星月书台 Setup 0.4.85.exe`；已于 2026-10-30 清理，见[清理记录](../maintenance/repository-cleanup-2026-10-30.md)。
- 大小：127,448,379 字节。
- SHA-256：`46fc3bbea018a4850c046de588f6b3f28778bce0886f07e2eb214afce9949072`。
- 本版清单：[delivery-0.4.85.json](../../output/xingyue-v7/delivery-0.4.85.json)。
- 匿名试读页：[anonymous-review.html](../../output/xingyue-v7/anonymous-review.html)，仍为既有 31 组样稿，没有追加付费生成。
- 历史交付：0.4.83、0.4.84 安装包均保留，对应清单为 `delivery-0.4.83.json`、`delivery-0.4.84.json`。

本轮没有覆盖 `D:\aiwenxu\wenxu-desktop` 中的已安装客户端，没有修改用户正式作品，也没有提交 Git。可安装上面的新版；安装包核验不等同于已经在该目录升级完成。

## 方案覆盖

| 范围 | 已完成的工程行为 | 实现与证据 |
| --- | --- | --- |
| R0—R2 架构、版本与权限 | 保留统一模型与工具网关、任务恢复、正式提交和旧技能；任务及视角契约贯穿请求与采纳 | [初批实施记录](xingyue-v7-implementation.md)、`src/core/workflows/`、`src/core/commands/` |
| R3 正文与记忆 | 正文、独立核对、人物覆盖、核心记忆以最终正文版本统一采纳；字段候选和调序复用此入口 | `runtime/commit-kernel.ts`、`workflows/revision-core.ts`、`commands/adoption.ts` |
| R4 长篇查询 | 延续已完成的增量事实索引、来源复用及全量重建一致性检查 | [性能记录](xingyue-v7-performance.json)，数值属于 0.4.83 实测，本轮没有重新测量 |
| R5 创作与反馈 | 19 个设计包、48 个操作、26 个旧资源映射保留；声音、首读、探索、人物回合、解法、阅读轨迹、匿名反馈入口接通 | [0.4.83 实施记录](xingyue-v7-implementation.md)、[0.4.84 续作记录](xingyue-v7-continuation.md) |
| 四层剧情 | 作品、卷、章、场景；剧情卡、因果链和章节列表共享对象；旧 Markdown 场景按需展开 | `workbench-plot.ts`、`PlotWorkbench.tsx` |
| 章节调序 | 鼠标拖动和键盘按钮产生候选；检查知情、伏笔、物品、人物、因果和来源；冲突理由进入候选指纹 | `workbench-reorder.ts`、`commands/workbench.ts` |
| 世界规则 | 模块卡具备范围、触发、边界、代价、例外和证据；可编辑因果连接，查看影响；固定模块在提交端受保护 | `world-model.ts`、`WorldWorkbench.tsx` |
| 空间示意 | 地点、路线、方向与显式距离；未设定值留空，示意坐标不构成地理事实 | `WorldWorkbench.tsx`、`WorkbenchGraph.tsx` |
| 人物外观与状态 | 可选图片上传、版本绑定和公开章节；状态沿已采纳来源展示，支持历史字段比较 | `workbench-media.ts`、`workbench-history.ts`、`CharacterWorkbench.tsx` |
| 画布候选闭环 | 当前与修改内容对照、单项或关联组采纳、保留分支、继续讨论和撤销；隐藏内部配置及事实标记 | `workbench-candidates.ts`、`WorkbenchCandidates.tsx` |
| 界面 | 来源与复杂字段按需展开；支持键盘、日间／夜间和窄屏；图表保持可读字号，在图内滚动 | `ObjectWorkbench.tsx`、`object-workbench.css`、`visual-ui.json` |

## 本批数据边界

剧情结构保存于 `05_长篇大纲/剧情结构.md`，头像元数据保存于 `11_创作素材/人物外观.md`，图片字节复用现有内容对象。世界模块仍使用原来的世界设定文件。新增显示坐标仅存在本地界面偏好中；没有建立另一个事实写入入口。

所有画布修改先形成任务候选。提交重新核对作品、快照、来源 hash、字段范围、关联组和固定状态；旧候选不能因重建或继续任务丢掉限制。正式采纳仍经过原有事务、指纹、核心记忆和幂等校验。

调序重新编号内容及剧情引用，不删除文件。实际移动的已写章节进入正文修订；同时混合已写与未写章节的移动会明确拒绝。明确接受倒叙时保存非线性标记。仅调整未写章节、场景计划或头像，不会使无关已确认人物事实失效；依赖该计划的细纲、任务及相关后续内容按影响范围核对。

场景固定在存储提交处校验，解除固定需要作者操作。世界固定保护覆盖模型对规则本身、关联图关系及所属地点的改写；作者手工操作沿用既有授权边界。头像不参与故事语义推断；未公开头像不会进入读者或人物范围。当前来源被外部修改时不再当作可用资料，已保存的历史版本仍可只读回看。

候选中的 JSON 结构转换成可读字段，普通文稿预览移除内部配置、事实记录和 HTML 注释。客户端没有新增开发说明、内部编号或调试提示；必要的来源、冲突和未知值仍按创作含义展示。

## 验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 全量自动回归 | **866/866 通过**，0 失败、0 跳过，645.1 秒；包含新增真实宿主调序采纳用例 | `.test-output/xingyue-v7/visual-full.tap` |
| 最后边界专项 | 19/19 通过，与全量重复，不累加；覆盖权限、字段锁、调序、图片、历史、同版核心与重建 | `visual-last-targeted.tap` |
| 契约 | 25 个根契约、830 个结构；输入输出和历史兼容检查通过 | `src/shared/contract-schemas.ts`、全量契约测试 |
| 最终构建 | TypeScript、Vite、Electron bundle 与 150 个依赖声明检查通过 | `visual-build-final.log` |
| 安装包 | NSIS x64 生成成功；版本、程序 bundle、前端及全部技能资源与源码一致 | `visual-installer.log`、`visual-integrity.log`、`visual-delivery.log` |
| 浏览器完整流程 | 调序、场景和头像共 3 次正式采纳；世界关系分支保存并撤销；最终无失效资料、无未捕获异常、无失败 RPC、模型请求 0 | `.test-output/xingyue-v7/visual-ui.json` |
| 视角与历史 | 读者看不到未公开头像或作者目标；历史版本没有编辑入口；人物字段可比较实际更早版本 | 同上 |
| 窗口尺寸 | 720、800、1280、1440 × 800，页面宽高无溢出；窄图表在内部滚动 | `output/playwright/v7-visual-map-*.png` |
| 视觉检查 | 实际查看剧情图、候选、人物状态、宽窄地图和日间地图截图 | `output/playwright/v7-visual-*.png` |

浏览器验收使用真实 Service、SQLite 和文件存储的隔离作品，模型调用器禁止发送请求。UI 测试中的图片、分支及样稿均为演示材料，不进入真人质量统计。

实际操作修正了左侧卷／章选择未同步剧情层级、图关系点击区域过窄和窄屏图形字体过小的问题。最初调序采纳也被测试夹具中无效的章节类型拦截；修正夹具后重新跑通，并增加正式宿主采纳回归。没有通过放松正式验证绕过该失败。

构建仍有 Vite 大 chunk 提示，不影响本次构建和打包成功。当前浏览器与 Windows 包核验不能外推其他操作系统或所有真实模型的兼容性。

主要复验命令：

```powershell
node scripts/generate-contract-schemas.mjs
node --import tsx --test --test-concurrency=2 --test-reporter=tap tests/*.test.ts
node --import tsx --test --test-concurrency=2 tests/workbench-visual.test.ts tests/object-workbench.test.ts tests/revision-core.test.ts
npm run build
node node_modules/electron-builder/cli.js --win nsis --config.directories.output=release/xingyue-v7
$env:WENXU_RELEASE_DIR='release/xingyue-v7'
node scripts/check-deliverables.mjs .test-output/xingyue-v7/visual-full.tap
```

当时另用 `finalize-v7-evidence.mjs` 复核并整理历史性能证据，没有重新计时。该一次性脚本已于 2026-10-30 退役，历史报告保留；当前交付使用[脚本说明](../../scripts/README.md)中的 `verify-v7-release.mjs`，显式传入本次日志。界面最后调整经浏览器复验和最终构建检查；全量回归中的工程及安全结果不替代视觉检查。

## 尚需外部样本的验收

授权的默认模型 **100 次调用已全部使用**，本轮新增调用为 0。真实模型的通过、拒收、修复和样稿长度偏差见 [质量结果](xingyue-v7-quality-results.md)，没有删除失败记录或追加预算。

真人盲评人数仍为 **0**；真实长篇连续创作、长期人物因果质量和平台留存等验收尚未完成。匿名试读和反馈导入入口已经交付，但不能由自动测试替代作者及目标读者判断。

此前截图中的 `Cannot read properties of undefined (reading 'id')` 尚未获得可重放的触发位置。此次浏览器流程没有复现，不能据此写成已经修复。该问题按用户“先继续方案”的指令保留为独立待定位项。

## 恢复

未采纳候选可撤销或保留分支；正式改变有快照和来源。旧 Markdown 资料保留，不能以删除作品、台账、请求预算或历史的方式回退。跨版本回退先保留完整作品备份，再使用旧安装包和相容的历史资料。
