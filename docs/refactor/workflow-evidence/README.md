# 0.4.4 验证证据

日期2026-10-11。`tests.log`为完整210项回归，`targeted-tests.log`为18项策划测试，`build.log`和`package.log`对应最终包。最后的辅助按钮分组与提示文案调整已重新构建，并通过`final-desktop.json`所记实际客户端复测。

`electron-smoke.json`记录首个隔离样本的输入保存、集中确认、旧结果保护、继续和暂停；`final-desktop.json`记录最终包的第二个全新样本。`mock-requests.json`与`final-mock-requests.json`仅含本地合成请求元数据，均为8次本机调用；不包含真实作者文本或密钥。截图是合成内容，不能作为文学质量示例。

`source-audit.json`沿用原始UI基线，预期报告本次两个组件的交互差异。`review.json`严格核对差异范围、其余组件、视觉资源、无新注释、依赖和最终渲染文件；`audit.mjs`为核对源码。`delivery-report.json`核对完整资源和安装包。`cleanup.json`记录测试进程及写锁退出。

`desktop-fixture.ts`保留本机模拟与隔离作品建立方法，原执行位置为`.test-output/workflow-20261011/`，相对导入基于该位置，需复制回该位置才能运行。第二个样本使用参数`final-sample`；不要在既有样本目录重复建书，也不能将测试目录设为真实作品目录。

复测可执行`npm test`、`npm run build`。打包使用`npx electron-builder --win nsis --config.directories.output=release/workflow`。资源校验设置环境变量`WENXU_RELEASE_DIR=release/workflow`后执行`scripts/check-deliverables.mjs`，参数为本次测试日志路径。所有模拟服务仅监听`127.0.0.1:19453`，验证结束即关闭。
