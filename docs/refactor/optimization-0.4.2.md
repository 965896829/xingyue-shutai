# 0.4.2 文档导入优化记录

2026-10-10。在0.4.1改造基础上解决已复现的文档导入阻塞，保持客户端UI、操作入口和作者确认流程，没有新增代码注释。完成范围是本地架构验证版；原来的执行器准入、真实供应商和覆盖安装门槛继续保留。

## 改动与原因

此前DOCX解压和XML解析直接运行在业务进程的事件循环上，解析期间查询和退出收尾也要等待。现在Electron将每次MD/TXT/DOCX预览交给独立Node线程，业务进程只负责排队、取消、输出校验和生命周期。

| 文件 | 变化 |
|---|---|
| `src/core/document-import.ts` | 提取不依赖数据库的解析器；保留原编码、标题、列表、表格及警告逻辑；读取前检查30MB，并在有界读取时再次限制增长 |
| `src/core/documents.ts` | 保留原导入导出入口，通过重新导出兼容解析调用；备份和导出行为不变 |
| `src/core/runtime/document-importer.ts` | 启动解析线程，校验返回，处理异常、超时和AbortSignal；等待线程退出后完成请求 |
| `electron/document-worker.ts` | 只读源文件，返回预览或错误；不接触项目数据库，不调用模型 |
| `src/core/service.ts`、`electron/worker.ts` | Electron注入线程实现；同一业务进程最多解析一个文档；drain停止队列并取消活动导入 |
| `src/shared/contracts.ts` | 修复导入返回契约丢弃源文件SHA256的问题；原name/content/warnings保留 |
| `scripts/build-main.mjs` | 打包新增document-worker入口，ASAR中共四个入口 |

单次解析截止为25秒。输入上限仍为30MB，DOCX解压声明大小仍限80MB、3000项；线程V8老生代限512MB、栈限4MB。V8限制不是整个进程或原生内存的绝对上限。每次导入建立新线程，因此有启动和数据复制开销；没有为了缩短耗时移除原稿核对、持久化或审批保护。

## 实际测量

固定合成DOCX包含50000段，正文XML为5400151字节，压缩文件18755字节，解析输出1349998个JS字符串字符。压缩率高是重复合成文本的结果，不能等同30MB真实DOCX的性能。输入SHA256为`6680d6181cfdf3c67272ed5f8eb5fd8160fe56a3222118de8d38fa74bcb96b98`。

Windows10 19045上依次运行0.4.1与0.4.2实际展开包，各3次。每次通过现有IPC发起导入，50ms后读取任务列表。测量前完整回归和打包已结束。两版使用同一个新建合成项目与独立userData；没有调用真实模型或读取作者作品。

| 指标 | 0.4.1，3次范围 | 0.4.2，3次范围 |
|---|---|---|
| 导入期间任务列表查询 | 828.8–863.8ms | 3.4–7.7ms |
| 完整预览返回 | 887.4–928.0ms | 934.3–1063.5ms |
| 导入正文 | 1349998字符 | 1349998字符，SHA256逐次一致 |
| 正式文档、任务 | 25份正式文档、0个任务，导入前后不变 | 同左 |
| 返回源文件hash | 被旧输出契约丢弃 | 正确保留 |

收益是导入期间的业务响应，不能据此宣称解析本身变快。以上为单机小样本，未计算缺乏样本基础的p95。原始数据：[旧包](optimization-evidence/electron-before.json)、[新包](optimization-evidence/electron-after.json)。

另有Node24.11.1下直接解析与线程解析各4次的事件循环实验：直接解析时10ms定时器实际等待1634.9–1765.8ms；隔离后首次响应9.9–23.4ms，采样中最大间隔16.3–24.7ms。运行时和测量对象不同，不与Electron数据混算。原始样本：[直接解析](optimization-evidence/import-before.json)、[线程解析](optimization-evidence/import-after.json)。

## 验证证据

`npm test`最终197项全部通过，0失败、0跳过、0取消，耗时212544.749ms。包含新增7项：DOCX内容与原文件一致、解析期间父线程响应、开始前/进行中取消、损坏与超限输入、解析超时、线程崩溃/非法返回、活动和排队导入的退出清理。类型检查与完整构建也通过。详见 [完整测试日志](optimization-evidence/tests.log)、[构建日志](optimization-evidence/build.log) 和 [新增测试源码](../../tests/document-importer.test.ts)。

全局Playwright MCP连接两个真实Electron包。文件选择对话框在各自隔离测试进程中通过main inspector返回指定合成文件；现有文件授权、IPC、业务进程、解析线程和ASAR加载均走实际代码。没有以此声称原生文件选择框已重新人工验收。当前包的既有导入弹窗完整显示预览，未勾选核对时“建立导入候选”保持禁用，见 [截图](../../output/playwright/optimization-0.4.2-import.png) 与 [桌面检查](optimization-evidence/electron-smoke.json)。

两个导入尚未结束时关闭测试窗口，程序随后退出且项目/管理仓库写锁全部释放，源文件SHA256不变，见 [退出清理](optimization-evidence/cleanup.json)。窗口关闭调用耗时不等同完整drain耗时；未将两者混为一项指标。

源码审计比较20个TSX组件结构、静态属性与文字，26项CSS/图像资源逐字节一致；93个源码文件没有新增注释，UI没有core导入。新增线程与main/preload/worker四个构建产物在ASAR中逐一匹配，生产包无Pi和测试标记，见 [源码及包审计](optimization-evidence/source-audit.json)。测试和检查辅助脚本的新增注释另作差异核对。

## 交付与边界

安装包：`release/optimization/星月书台 Setup 0.4.2.exe`，126579818字节，SHA256为`553125e07bb1bae703ea301fca2246c53a998327650caea381ba5ed363128d44`。展开目录：`release/optimization/win-unpacked`。完整资源核对见 [交付报告](optimization-evidence/delivery-report.json)，复测入口见 [证据说明](optimization-evidence/README.md)。

没有新增依赖，项目/数据库/IPC版本不变，0.4.1产物保留，原安装和用户配置未覆盖。源码留在原工作树，没有提交或推送。

Electron生产入口使用独立解析线程；直接构造Service时的兼容默认仍是同步解析。没有新增导入停止按钮，关闭弹窗/取消IPC等待不等同取消后台解析；退出drain可取消解析。仍未实现任意大文档的流式解析、分块持久化和断点续导。完整跨硬件UI性能、真实Windows覆盖安装、Pi准入和付费模型验证仍按 [风险登记](risk-register.md) 保留。
