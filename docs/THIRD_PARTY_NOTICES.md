# 第三方组件

Nexora Mount 自有源代码使用 MPL-2.0。以下组件保留各自许可证；对应原文随软件模块或本目录的 licenses 文件夹分发。

| 运行时组件 | 许可 | 项目 |
| --- | --- | --- |
| Electron | MIT，及 Chromium/Node.js 等第三方许可 | https://www.electronjs.org/ |
| Vue | MIT | https://vuejs.org/ |
| Pinia | MIT | https://pinia.vuejs.org/ |
| Koffi 与 @koromix 原生模块 | MIT | https://koffi.dev/ |
| Zod | MIT | https://zod.dev/ |
| Lucide | ISC | https://lucide.dev/ |

Electron 的发行文件还包含引擎第三方许可说明（LICENSE.electron.txt、LICENSES.chromium.html 等）。系统 SMB、WebDAV、NetFS、CoreFoundation、WNet 接口由操作系统提供，不随应用重新分发。

开发工具及其依赖的版本记录在 pnpm-lock.yaml。发布者更换依赖或分发方式时，应同时更新许可清单并保留相应原文。
