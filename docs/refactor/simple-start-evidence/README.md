# 0.4.5 操作验证证据

从真实新建作品表单开始，测试使用 `.test-output/newbook-20261011` 隔离目录、全局 Playwright MCP 和本机模拟模型，未访问作者真实配置或作品。

`*-result.json` 为界面操作断言结果，`*-playwright.js` 是对应流程代码；`desktop-fixture.ts` 提供模拟模型响应，`select-test-directory.mjs` 只允许在指定隔离配置进程中替代原生目录选择框。复现时需要启动对应隔离客户端并准备本机模拟配置。模型能力异常用例中的暂停与交接分别执行；脚本合并为连续复现步骤。

`tests.log`、`build.log`、`package.log` 对应完整回归、最终构建和打包。`source-audit.json` 沿用原架构基线，两个组件的结构差异为本次授权交互调整，`audit.mjs` 核实其余结构、样式、注释与包内容，结果见 `delivery-report.json`。

阶段结果为合成材料，不能作为小说质量示例。详细体验结果与测试边界见 [交付记录](../simple-start-0.4.5.md)。

复现脚本的相对导入以原测试目录为基准；应放回 `.test-output/newbook-20261011` 后从仓库根目录执行。模型与目录选择桩只用于隔离验收，不属于产品包。
