# 首版验证记录

日期：2026-10-21。开发环境：Apple Silicon macOS，Node.js 22、Electron 45。

| 检查 | 结果 |
| --- | --- |
| TypeScript / Vue 类型检查 | 通过 |
| 业务单元测试 | 18 项通过；Windows 原生枚举测试在 macOS 上跳过 |
| Electron 桌面自动化 | 通过：SMB/WebDAV 配置、编辑、不可达地址反馈、落盘、诊断、渲染隔离、关闭到托盘再打开 |
| macOS 原生挂载表 | 通过：实际调用系统接口读取 |
| macOS 原生 WebDAV | 通过：临时本机 Apache 服务，真实挂载、中文文件读写、重命名、删除、刷新、正常卸载；清理完成 |
| Apple Silicon 测试应用 | 已启动并读取实际系统挂载表；安装包未使用 Developer ID 签名、公证 |
| Intel Mac 应用 | 已配置并构建 x64 产物；本机 Rosetta 自动化未完成，不计为 Intel 真机验收 |
| Windows | 构建目标为 x64 NSIS；当前没有 Windows 真机验收证据 |
| 最终安装包 | Apple Silicon/Intel DMG 与 Windows x64 NSIS 均构建成功；两个 DMG 的 hdiutil 完整性检查通过；SHA-256 记录于 dist/SHA256SUMS.txt |
| GitHub CI | 已发布公开仓库并启用 Windows/macOS 工作流，最新运行结果见 [Actions](https://github.com/zhangzzj2003/Nexora-Mount/actions/workflows/check.yml)；Windows 测试按实际 WebClient 可用性分别验证网络错误或依赖提示 |
| 真实 NAS / 双电脑 AI | 尚未提供 NAS 环境，需要按 acceptance.md 验收 |

网络不可达测试使用已释放的本机端口，避免本机代理的 Fake-IP 使保留域名产生错误的端口可达结果。原生 WebDAV 测试只监听 127.0.0.1，不暴露局域网服务。

本记录不代表文件在任意网络故障中均不会丢失，也不代表任意 AI 工具能及时刷新外部修改。实际工作项目应使用 NAS 快照/备份并协调并发任务。
