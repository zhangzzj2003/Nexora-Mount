import { MacAdapter } from './native/mac'
import { WindowsAdapter } from './native/windows'
import { failure, MountError } from './errors'
import { reachable } from './native/adapter'
import type { Connection, MountInfo } from '../shared/types'

// 每个请求使用独立 utilityProcess：原生调用超时后可结束进程，不阻塞桌面或其他连接。
const port = (process as NodeJS.Process & { parentPort: { on: Function; postMessage: Function } })
  .parentPort
port.on(
  'message',
  async ({
    data
  }: {
    data: { action: string; connection?: Connection; password?: string; mount?: MountInfo }
  }) => {
    try {
      const adapter =
        process.platform === 'darwin'
          ? new MacAdapter()
          : process.platform === 'win32'
            ? new WindowsAdapter()
            : null
      if (!adapter) throw new MountError('DEPENDENCY', '首版仅支持 Windows 与 macOS。')
      let value: unknown
      switch (data.action) {
        case 'list':
          value = await adapter.listMounts()
          break
        case 'probe':
          value = await adapter.probe(data.connection!)
          break
        case 'mount':
          value = await adapter.mount(data.connection!, data.password ?? '')
          break
        case 'unmount':
          value = await adapter.unmount(data.mount!)
          break
        case 'check':
          // 本地挂载表和目录权限可能来自系统缓存，额外探测服务端口识别断网。
          if (data.connection && !(await reachable(data.connection)))
            throw new MountError('NETWORK', 'NAS 服务暂时不可达。')
          value = await adapter.check(data.mount!)
          break
        default:
          throw new MountError('INVALID', '不支持的系统操作。')
      }
      port.postMessage({ ok: true, value })
    } catch (e) {
      port.postMessage({ ok: false, error: failure(e) })
    }
  }
)
