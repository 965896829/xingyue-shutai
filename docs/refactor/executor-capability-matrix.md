# 执行器准入

生产默认 LegacyAdapter；Pi 开关关闭，且准入标志固定为 false。即使请求 Pi，也不会自动接入未准入路径；既有未知 Pi checkpoint 只读保留。

选定 @mariozechner/pi-agent-core 0.73.1，npm 元数据要求 Node >=20；实际Node24/Electron44。版本和完整依赖由 package-lock 固定。包已声明弃用并指向新作用域，本轮没有同时引入第二套框架。

| GATE | 本次证据 | 结论 |
|---|---|---|
| 01 网关覆盖 | 假 provider 两轮、所有入口计数与原生续轮 | 离线通过 |
| 02 无隐藏重试 | unknown 注入、restore不联网 | 离线通过 |
| 03 四协议保真 | Legacy四协议 fixtures通过；Pi仅统一消息层合成 native round-trip | Pi完整四协议矩阵未准入 |
| 04 等待关键写入 | 阻塞checkpoint时工具计数0；checkpoint失败中止 | 离线通过 |
| 05 工具权限 | schema、伪造正式工具拒绝、真实独立草稿/候选/作者提交 | 离线通过 |
| 06 取消/项目切换 | adapter stop，网关取消；生产Legacy切换/退出有实包证据 | Pi完整项目切换矩阵未准入 |
| 07 辅助预算 | 使用共用预算账本；并发预留及未知阻断通过 | Pi完整辅助功能组合未准入 |
| 08 无双主 | 自有对象/checkpoint、restore不再请求 | 离线通过 |
| 09 Windows打包 | 生产包刻意不含Pi依赖，未验证Pi实包 | 未准入 |
| 10 许可/供应链 | MIT元数据、提交绑定许可、锁文件、审计；开发依赖仍有高危项 | 未准入 |

Pi conformance 顺序完成只读 → 实际独立草稿文件 → 候选 → 可信作者提交。不是正式模型质量验收。Legacy继续保留 Chat/Responses/Anthropic/Gemini；Images 仍由封面功能独立处理。

许可依据：[固定提交 MIT License](https://raw.githubusercontent.com/badlogic/pi-mono/781152fc24841dc54b22284514604048ebe5e2c9/LICENSE)。npm tarball本身未包含 LICENSE文件，故另存固定提交许可；元数据见 test-evidence/pi-package-metadata.json。生产 npm audit --omit=dev 为0，开发树存在8项moderate和6项high，Pi关联 basic-ftp/proxy-agent 等依赖链阻止正式准入。不能把生产审计0解释成开发环境没有风险。
