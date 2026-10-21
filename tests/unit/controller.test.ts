import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Controller, type SystemBridge } from '../../src/main/controller'
import { Storage } from '../../src/main/storage'
import { MountError } from '../../src/main/errors'
import type { MountInfo } from '../../src/shared/types'
import { remoteUrl } from '../../src/shared/address'
import { smb } from './fixtures'

const paths: string[] = []
async function setup() {
  const path = await mkdtemp(join(tmpdir(), 'nexora-controller-'))
  paths.push(path)
  const store = new Storage(path, { available: () => true, encrypt: (x) => x, decrypt: (x) => x })
  await store.load()
  await store.save(smb)
  let mounts: MountInfo[] = []
  const call = vi.fn(async (action: string): Promise<any> => {
    if (action === 'list') return mounts
    if (action === 'probe') return { available: true, reachable: true, warnings: [] }
    if (action === 'mount') {
      const m: MountInfo = {
        remote: remoteUrl(smb),
        local: '/Volumes/项目',
        protocol: 'smb',
        readOnly: false
      }
      mounts = [m]
      return m
    }
    if (action === 'unmount') {
      mounts = []
      return
    }
  })
  const controller = new Controller(store, { call } as SystemBridge, 'darwin', 'test', () => {})
  return { controller, call, store }
}
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(paths.splice(0).map((p) => rm(p, { force: true, recursive: true })))
})
describe('连接生命周期', () => {
  it('重复点击连接仅执行一次系统挂载', async () => {
    const { controller, call } = await setup()
    await Promise.all([controller.mount(smb.id), controller.mount(smb.id)])
    expect(call.mock.calls.filter((x) => x[0] === 'mount')).toHaveLength(1)
    expect(controller.snapshot().connections[0].state.status).toBe('mounted')
    await expect(controller.save(smb)).rejects.toThrow('卸载')
    await expect(controller.remove(smb.id)).rejects.toThrow('卸载')
  })
  it('网络失败安排重试，认证失败停止重试', async () => {
    const { controller, call } = await setup()
    call.mockImplementation(async (action) => {
      if (action === 'list') return []
      if (action === 'probe') throw new MountError('NETWORK', '网络断开')
    })
    await expect(controller.mount(smb.id)).rejects.toThrow('网络断开')
    expect(controller.snapshot().connections[0].state.status).toBe('retrying')
    call.mockImplementation(async (action) => {
      if (action === 'list') return []
      throw new MountError('AUTH', '认证失败')
    })
    await controller.mount(smb.id).catch(() => {})
    expect(controller.snapshot().connections[0].state.retryAt).toBeUndefined()
  })
  it('超时后发现并检查实际挂载，不重复挂载', async () => {
    const { controller, call } = await setup()
    let mounted = false
    call.mockImplementation(async (action) => {
      if (action === 'list')
        return mounted
          ? [
              {
                remote: remoteUrl(smb),
                local: '/Volumes/project',
                protocol: 'smb',
                readOnly: false
              }
            ]
          : []
      if (action === 'probe') return { available: true, reachable: true, warnings: [] }
      if (action === 'mount') {
        mounted = true
        throw new MountError('TIMEOUT', '超时')
      }
    })
    await controller.mount(smb.id)
    expect(controller.snapshot().connections[0].state.status).toBe('mounted')
  })
  it('卸载占用目录时保留错误及实际位置', async () => {
    const { controller, call } = await setup()
    await controller.mount(smb.id)
    const implementation = call.getMockImplementation()!
    call.mockImplementation(async (action) => {
      if (action === 'unmount') throw new MountError('BUSY', '文件正在使用')
      return implementation(action)
    })
    await expect(controller.unmount(smb.id)).rejects.toThrow('文件正在使用')
    expect(controller.snapshot().connections[0].state.local).toBe('/Volumes/项目')
  })
  it('诊断中不包含地址、用户名与密码', async () => {
    const { controller } = await setup()
    await controller.mount(smb.id)
    const json = controller.diagnostics()
    expect(json).not.toContain('nas.invalid')
    expect(json).not.toContain('/Volumes/')
    expect(json).toContain('mounted')
  })
})
