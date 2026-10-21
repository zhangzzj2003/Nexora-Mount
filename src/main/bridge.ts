import { utilityProcess } from 'electron'
import { join } from 'node:path'
import type { Result } from '../shared/types'
import { MountError } from './errors'
import type { SystemBridge } from './controller'

export class NativeBridge implements SystemBridge {
  private workers = new Set<ReturnType<typeof utilityProcess.fork>>()
  call<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const worker = utilityProcess.fork(join(__dirname, 'worker.js'), [], {
        stdio: 'ignore',
        serviceName: 'Nexora 系统连接'
      })
      this.workers.add(worker)
      let settled = false
      const finish = (result: Result<T>) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.workers.delete(worker)
        worker.kill()
        if (result.ok) resolve(result.value)
        else reject(new MountError(result.error.code, result.error.message, result.error.detail))
      }
      const timer = setTimeout(
        () =>
          finish({
            ok: false,
            error: {
              code: 'TIMEOUT',
              message: '系统操作超时，请检查网络；应用会重新核对实际挂载状态。'
            }
          }),
        action === 'mount' ? 45000 : 10000
      )
      worker.once('spawn', () => worker.postMessage({ action, ...payload }))
      worker.once('message', finish)
      worker.once('exit', () =>
        finish({
          ok: false,
          error: { code: 'SYSTEM', message: '系统连接进程意外退出，请重试并检查诊断信息。' }
        })
      )
    })
  }
  close() {
    for (const worker of this.workers) worker.kill()
    this.workers.clear()
  }
}
