# 开发说明

## 结构与数据流

- `src/shared`：连接配置判别联合、状态和错误类型、地址校验。配置由后台再次验证。
- `src/main`：配置事务、系统凭证加密、连接队列、重连状态、IPC、托盘。
- `src/main/native`：Koffi 平台适配，统一提供 probe/mount/unmount/listMounts/check。
- `src/preload`：只暴露业务白名单。界面无法执行任意命令、读取任意路径。
- `src/renderer`：Vue/Pinia 界面。连接状态以主进程快照为准。

每次系统调用在独立 Electron utilityProcess 中执行。挂载最多等待 45 秒，其他操作最多等待 10 秒。超时后终止工作进程并重新枚举系统挂载，避免重复挂载。原生调用不使用包含密码的命令行，也不通过 shell 拼接命令。

Windows：WNetAddConnection2W/WNetCancelConnection2W/WNetGetConnectionW；WebDAV 转换为 DavWWWRoot UNC。通过服务管理与注册表只读接口检查 WebClient 与单文件限制。GetLogicalDrives 避免占用本地盘符。当前版本管理 D: 至 Z: 的映射。

macOS：NetFSMountURLSync/CoreFoundation 管理 URL 和凭证，使用 NoUI 防止后台弹出认证窗口；getmntinfo 枚举原生挂载并读取只读标志；unmount 以非强制方式卸载。NetFS 可能复用系统凭证和已有会话，最终身份受系统会话规则影响。

## 状态与恢复

连接操作按 ID 排队；配置更新还有全局事务队列。挂载完成和程序重启后都检查系统实际状态。后台每 5 秒执行一次状态调度，网络失败按 5/10/20/40/60 秒退避，后续上限 60 秒。认证、证书、权限和依赖错误不自动重试。

仍存在的离线挂载先检查网络与目录，不强制拆除卷；恢复网络后再次验证。原生客户端无法恢复的残留连接需要用户正常卸载后重连，不能保证任意应用的已打开句柄跨断线保持有效。

主动卸载关闭该连接本轮自动重连意图。自动连接配置仅在应用启动时生效，登录自动启动应用是独立设置。应用退出保留系统挂载。

## 存储与诊断

配置位于 Electron `userData/connections.json`，带版本号；写入临时文件后原子重命名。配置损坏时停止启动并保留原文件。密码密文由 safeStorage 生成；macOS 依托 Keychain，Windows 依托 DPAPI。同一 Windows 用户下的其他进程仍属于系统加密模型的边界。

编辑时密码留空保留密文；显式清除才删除密文；更换用户名而未提供新密码时清除旧凭证。诊断事件只记录时间、动作、随机连接 ID 和错误类别，最多保留 300 条本次会话记录，不包含地址、账号与文件路径。

## 开发原则

功能逻辑、原生接口与关键异常处理添加中文注释。不要绕过 TLS，不自动修改系统策略，不在未知写入状态下强制卸载。应用不承诺合并代码或更新已经进入 AI 上下文的旧内容。

## 持续集成（CI）

配置位于 `.github/workflows/check.yml`，Windows/macOS 使用同一检查顺序：锁定依赖安装 → 格式检查 → 类型检查 → 业务和本机原生接口测试 → Electron 桌面自动化 → 未签名目录包构建。Node.js 使用 22，pnpm 版本读取 `package.json` 的 `packageManager`；缓存按 `pnpm-lock.yaml` 区分。

所有分支推送、PR 和手动运行都会触发检查。`main` 推送及手动运行额外生成 macOS arm64/x64 DMG 和 Windows x64 NSIS 安装包，保存到 Actions Artifacts 14 天，不自动发布 Release。PR 和其他分支只验证目录包。单个平台最多运行 30 分钟，同一分支或 PR 的新提交会取消旧检查；两个平台的错误独立报告。

CI 使用只读源码权限，不需要 NAS 凭证或签名密钥。失败时保留 Playwright 跟踪、截图和构建诊断 7 天（存在时上传）。本地可运行 `pnpm format:check`、`pnpm typecheck`、`pnpm test` 和 `pnpm test:e2e` 复现检查；格式修复使用 `pnpm format`。`.gitattributes` 统一文本换行为 LF，避免 Windows 自动转换后产生格式误报。

真实 NAS、双电脑 AI 操作及证书发布需要独立验收。GitHub 构建成功不表示已完成物理 Windows 电脑、Intel Mac 或真实 NAS 的安装和读写验收。
