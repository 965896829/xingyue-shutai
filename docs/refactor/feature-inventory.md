# 功能保留与回归映射

| 既有功能 | 保留实现/验收 |
|---|---|
| 新建、打开、旧档案导入、版本1/2、回收站 | service、migration、recycle-bin；core/recycle/compatibility/assistant/studio 测试 |
| 482标签、方向规划、独立审核、S01契约及全阶段约束 | tag-planning/tags；tags.test、expression.test，全流程离线测试 |
| S01—S11、正文/记忆联合采纳、批次归档 | runner/service/storage；workflow.test 与 studio.test |
| 创作讨论、多主题、重命名、归档、引用聊天 | conversation-runner/conversations；assistant.test；真实 Electron 页面与幂等主题创建 |
| 独立草稿、版本、转修订提案、明确确认执行 | assistant.test；Pi conformance 使用真实 Conversations.saveDraft 保存独立文件 |
| 候选审阅、手动保存、差异、历史、重新核对 | 原组件保留；审批/幂等/过期/历史分页测试 |
| 自然表达规则、命名规则、原技能库 | expression/naming/skill 及资源锁测试；未删减规则换取上下文容量 |
| 四种文字协议及 Images | 原 provider 实现保留；protocol、stream-recovery、model-catalog 测试；真实付费端点未测 |
| 分层记忆、FTS、向量、人物、叙事评估 | memory/studio/embeddings/telemetry；studio.test，过期来源和代次检查 |
| 封面生成、编辑、独立保存 | 原 Cover UI 保留；生成加入外部调用账本；实际图像服务未调用 |
| MD/TXT/DOCX、备份、恢复 | core/workflow/studio，WAL、缺对象、旧字节、Unicode/CRLF/BOM 测试 |
| 供应商分组、加密 Key、模型目录、连接测试 | provider/model-catalog/model-limits；实包设置页可打开，合成本机服务可调用 |
| 日夜主题、菜单、窗口、退出确认 | 原组件/样式/图标保留；appearance/close-confirmation 测试，实包截图 |
| 未保存编辑及外部文件提醒 | 实包中外部修改、worker 崩溃、全进程重启后合成编辑仍在 |
| 历史任务、聊天、快照、文稿版本 | 原入口内按需分页；历史任务/快照选择框聚焦时读取后续页，不增加按钮或布局 |

20个可恢复基线的 TSX 文件，元素、静态属性和文本骨架相同；26个样式/图形资源字节相同。此检查不把事件处理函数和数据表达式当作视觉布局。真实深浅色截图在 output/playwright。未声称每个按钮均已对真实第三方服务完成端到端验证。
