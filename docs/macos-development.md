# 从 Windows 迁到 Mac mini 开发

本分支是 **0.4.97 的跨平台准备版 `0.4.97-macos.1`**，基于提交 `af432744ea3bc9e9bea26ec7ee1aa56b6f6f2788`。创作流程、作品格式和提示词保持该基线。后续实验室和对话式创作版本没有合入。

源码分支：[`codex/macos-0.4.97`](https://github.com/965896829/xingyue-shutai/tree/codex/macos-0.4.97)。请下载此分支，仓库默认分支可能是另一个版本。

## 1. 下载源码

推荐使用 Git，便于之后提交和同步：

```sh
git clone --branch codex/macos-0.4.97 --single-branch https://github.com/965896829/xingyue-shutai.git
cd xingyue-shutai
```

也可以在该分支页面点击 **Code → Download ZIP**，解压后在终端进入包含 `package.json` 的目录。ZIP 不包含 Git 历史；准备长期开发时优先使用 Git。

不要从 Windows 复制 `node_modules`、`dist-electron` 或安装目录。在 Mac 上按锁文件重新安装依赖，才能获得正确的 Electron、esbuild 等本机二进制。

## 2. 安装开发环境

- macOS **13.5 或更新版本**，符合 [Node.js 24 支持范围](https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list)；具体目标系统仍需要实机验收。
- Node.js **24.x，至少 24.11.1**。M 系列 Mac mini 安装 **ARM64** 版本，Intel Mac 安装 x64 版本。使用普通原生终端，不通过 Rosetta 启动开发工具。
- Git；如系统提示安装 Apple 命令行开发工具，执行 `xcode-select --install` 并完成安装。
- 任意代码编辑器。

项目提供 `.nvmrc`。已安装 nvm 时可执行 `nvm install`、`nvm use`；没有 nvm 时也可以直接安装官方 Node.js 24.x。

```sh
node --version
node -p "process.arch"
npm ci
npm run doctor
```

`doctor` 核对 Node、系统版本、CPU 架构、SQLite 和 Electron 是否匹配，不读取作品或模型配置、不发送模型请求。依赖下载失败时先检查网络；不要关闭 TLS 校验或跳过完整性校验。

## 3. 首次开发启动

```sh
npm run dev:isolated
```

此命令把开发配置放在仓库的 `.test-output/development-profile/`，不会使用已安装客户端的正常配置目录。首次调试请新建测试作品到独立目录。隔离配置不限制你手动打开其他作品，因此首次验证不要选择正在创作的原件。

开发服务只监听 `127.0.0.1:5173`。端口被占用时明确报错，不会悄悄换端口再加载错误的服务。

正常配置启动使用 `npm run dev`。macOS 正常配置目录是 `~/Library/Application Support/wenxu-desktop/`；Windows 正常配置目录是 `%APPDATA%\wenxu-desktop\`。可通过 `WENXU_DATA_DIR` 指定其他目录。

```sh
npm test
npm run build
npm start
```

`npm start` 使用正常配置目录。需要以编译模式继续隔离验收时使用：

```sh
WENXU_DATA_DIR="$PWD/.test-output/development-profile" npm start
```

编译、默认回归和打包均不调用真实模型。真实请求仍需要单独配置模型和明确授权。

## 4. 在 Mac 上打包

```sh
npm run pack:mac
npm run dist:mac
```

- `pack:mac`：先检查环境并构建，再输出 `.app` 到 `release/mac-arm64/`（Apple 芯片）或 `release/mac/`（Intel）。
- `dist:mac`：输出包含版本和架构名的 `.dmg` 与 `.zip`，位于 `release/`。
- 两条命令都按当前原生 Node.js 架构构建；检测到 Rosetta 或非 macOS 会停止并给出原因。没有在 Windows 上伪造 Mac 构建结果，也不会自动上传或发布安装包。
- Windows 的 `npm run pack` / `npm run dist` 保持原用途。

当前 Mac 包使用 **ad-hoc 开发签名**，没有 Apple Developer ID 和公证，不是已认证的公众发行包。首次在目标 Mac 上使用时优先本机从源码构建。若 Gatekeeper 拦截，请按照系统“隐私与安全性”的提示核对来源；不要全局关闭 Gatekeeper、SIP 或 TLS 校验。

未来正式分发时，需要另行配置 Developer ID、公证和稳定签名身份，并复验钥匙串在升级后的行为。签名证书、密码和模型 Key 不进入仓库。参考 [electron-builder 26 签名说明](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/)。

## 5. 搬迁作品与模型配置

GitHub 只保存源码，**下载仓库不会带回你的作品、模型配置或 API Key**。

1. 在 Windows 的原客户端保存编辑，等待任务停止。打开“导入、导出与备份”→“历史与备份”→“立即完整备份”，把每部作品备份到作品目录之外。
2. 保留 Windows 原作品和完整备份。把完整备份文件夹复制到 Mac，包含隐藏的 `.novelclient`、`wenxu-backup.json` 和全部内容；不要只复制可见 Markdown。可以先压缩整个备份目录，再传输和解压。
3. 在 Mac 客户端选择“校验并恢复备份”（未打开作品时为“校验备份并恢复到新目录”），选择备份目录和新的本机保存位置。恢复会核对内容并创建新目录，不覆盖 Windows 原件。
4. 打开恢复结果，核对章节、候选、记忆和历史。重新设置自动备份目录及其他指向 Windows 盘符的外部路径，确认后再继续创作。
5. 在 Mac 的模型设置中重新填写供应商地址、协议、模型名称和原有参数，再填写 API Key。Windows 密文依赖原系统，不能靠复制 `settings.json` 在 Mac 解密；搜索、Embedding 等服务的 Key 同样需要重新填写。
6. 完成目标 Mac 验收并另存一份 Mac 备份后，再决定如何整理 Windows 副本。

Mac 使用系统钥匙串保存密钥。开发版签名变化可能导致系统再次询问钥匙串访问权限，正式分发前需要稳定签名验证。参考 [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)。

此分支保持 0.4.97 数据兼容边界；较新版本升级过格式的作品应先保留原件，不能承诺旧版可以打开。

## 6. 自动检查与剩余实机验收

[Windows and macOS preparation 工作流](../.github/workflows/desktop-platforms.yml) 在本分支推送时执行 Windows x64、Mac ARM64 和 Mac Intel 的依赖安装、离线回归和构建。Mac 构建产物保留 14 天；应查看对应提交的运行结果，不能把工作流文件存在当作检查通过。

CI 构建与命令行检查不能代替目标 Mac 的交互验收。首次使用时逐项确认：

- 窗口、原生菜单、中文输入、Cmd+C/V/Z、深浅主题切换和退出确认。
- 测试作品新建、关闭重开、保存、完整备份、恢复、导出。
- 使用一个非真实占位 Key 验证保存、退出、重启后的钥匙串读取；不要点击连通测试。
- 获得真实请求授权后再验证生成、取消与断网恢复；结果未知时按原客户端规则处理。

本分支保留“关闭最后一个窗口时确认并退出”的行为，退出会按原机制等待内核关闭；不在窗口关闭后静默继续生成。
