import { contextBridge, ipcRenderer } from 'electron'
import type { Backend, Result, Snapshot } from '../shared/types'

async function call<T>(name: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke(`nexora:${name}`, ...args)) as Result<T>
  if (!result.ok) {
    const error = new Error(result.error.message)
    error.name = result.error.code
    throw error
  }
  return result.value
}
// 界面仅获得业务方法，不能拿到 ipcRenderer、文件系统或任意命令执行能力。
const api: Backend = {
  snapshot: () => call('snapshot'),
  save: (input, password) => call('save', input, password),
  remove: (id) => call('remove', id),
  mount: (id) => call('mount', id),
  unmount: (id) => call('unmount', id),
  probe: (id) => call('probe', id),
  open: (id) => call('open', id),
  refresh: () => call('refresh'),
  settings: (input) => call('settings', input),
  diagnostics: () => call('diagnostics'),
  exportDiagnostics: (content) => call('exportDiagnostics', content),
  onChange: (callback) => {
    const handler = (_: unknown, snapshot: Snapshot) => callback(snapshot)
    ipcRenderer.on('nexora:changed', handler)
    return () => ipcRenderer.removeListener('nexora:changed', handler)
  }
}
contextBridge.exposeInMainWorld('nexora', api)
