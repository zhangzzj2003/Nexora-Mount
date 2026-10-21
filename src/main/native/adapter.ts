import { connect } from 'node:net'
import type { Connection, MountInfo, Probe } from '../../shared/types'

export interface MountAdapter {
  probe(connection: Connection): Promise<Probe>
  mount(connection: Connection, password: string): Promise<MountInfo>
  unmount(mount: MountInfo): Promise<void>
  listMounts(): Promise<MountInfo[]>
  check(mount: MountInfo): Promise<void>
}
export function reachable(c: Connection): Promise<boolean> {
  const u = c.protocol === 'webdav' ? new URL(c.url) : null
  const host = (u?.hostname ?? (c.protocol === 'smb' ? c.host : '')).replace(/^\[|\]$/g, '')
  const port = u ? Number(u.port || (u.protocol === 'https:' ? 443 : 80)) : 445
  // 测试仅探测网络端口，不在远程目录创建文件；权限由实际挂载及读写验收确认。
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(ok)
    }
    // socket.setTimeout 不包含 DNS 查询等待，因此另设覆盖整个探测的时间上限。
    const timer = setTimeout(() => finish(false), 4000)
    socket.setTimeout(4000)
    socket
      .once('connect', () => finish(true))
      .once('error', () => finish(false))
      .once('timeout', () => finish(false))
  })
}
