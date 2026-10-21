import { randomUUID } from 'node:crypto'
import { sameRemote, remoteUrl, validateConnection, windowsRemote } from '../shared/address'
import type {
  Connection,
  Diagnostic,
  MountInfo,
  MountState,
  Probe,
  Settings,
  Snapshot
} from '../shared/types'
import { Storage } from './storage'
import { failure, MountError } from './errors'

export interface SystemBridge {
  call<T>(
    action: string,
    payload?: { connection?: Connection; password?: string; mount?: MountInfo }
  ): Promise<T>
}
export class Controller {
  private states = new Map<string, MountState>()
  private mounts = new Map<string, MountInfo>()
  private wanted = new Set<string>()
  private queues = new Map<string, Promise<unknown>>()
  private attempts = new Map<string, number>()
  private events: Diagnostic[] = []
  private refreshing = false
  constructor(
    private storage: Storage,
    private bridge: SystemBridge,
    private platform: string,
    private version: string,
    private changed: () => void
  ) {}
  snapshot(): Snapshot {
    return {
      connections: this.storage.list().map((config) => ({
        config,
        hasPassword: this.storage.hasPassword(config.id),
        state: this.states.get(config.id) ?? { status: 'disconnected' }
      })),
      settings: this.storage.settings(),
      platform: this.platform,
      version: this.version
    }
  }
  private config(id: string) {
    const c = this.storage.list().find((x) => x.id === id)
    if (!c) throw new MountError('INVALID', '连接不存在，请刷新列表。')
    return c
  }
  private set(id: string, state: MountState) {
    this.states.set(id, { ...state, checkedAt: Date.now() })
    this.changed()
  }
  private log(action: string, id?: string, code?: Diagnostic['code']) {
    // 诊断仅保存事件类型和随机连接 ID，绝不保存 URL、用户名、密码或原生异常文本。
    this.events.push({ time: new Date().toISOString(), action, connectionId: id, code })
    this.events = this.events.slice(-300)
  }
  private serial<T>(id: string, run: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(id) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(run)
    this.queues.set(id, next)
    void next
      .finally(() => {
        if (this.queues.get(id) === next) this.queues.delete(id)
      })
      .catch(() => {})
    return next
  }
  private match(c: Connection, mounts: MountInfo[]) {
    const remote = this.platform === 'win32' ? windowsRemote(c) : remoteUrl(c)
    return mounts.find(
      (m) =>
        m.protocol === c.protocol &&
        sameRemote(m.remote, remote) &&
        (!c.drive || this.platform !== 'win32' || m.local === c.drive)
    )
  }
  private connected(id: string, m: MountInfo) {
    this.mounts.set(id, m)
    this.attempts.delete(id)
    this.set(id, { status: 'mounted', local: m.local, readOnly: m.readOnly })
  }
  private rejected(id: string, e: unknown) {
    const error = failure(e)
    const retryable =
      ['NETWORK', 'TIMEOUT'].includes(error.code) &&
      this.wanted.has(id) &&
      this.storage.settings().reconnect
    const attempt = this.attempts.get(id) ?? 0
    const retryAt = retryable
      ? Date.now() + Math.min(60000, 5000 * 2 ** Math.min(attempt, 4))
      : undefined
    this.attempts.set(id, attempt + 1)
    this.set(id, {
      status: retryable ? 'retrying' : 'error',
      error,
      local: this.mounts.get(id)?.local,
      retryAt
    })
    this.log('operation-failed', id, error.code)
  }
  async initialize() {
    await this.refresh()
    for (const c of this.storage.list()) {
      if (c.autoConnect || this.mounts.has(c.id)) this.wanted.add(c.id)
      if (c.autoConnect && !this.mounts.has(c.id)) await this.mount(c.id).catch(() => {})
    }
  }
  async save(input: Connection, password?: string) {
    let c: Connection
    try {
      c = validateConnection(input)
    } catch (e) {
      throw new MountError(
        'INVALID',
        e instanceof Error && e.name !== 'ZodError' ? e.message : '输入格式不正确，请检查连接信息。'
      )
    }
    return this.serial('configuration', () =>
      this.serial(c.id, async () => {
        const actual = await this.bridge.call<MountInfo[]>('list')
        const previous = this.storage.list().find((x) => x.id === c.id)
        if (this.mounts.has(c.id) || (previous && this.match(previous, actual)))
          throw new MountError('BUSY', '请先卸载连接，再编辑配置。')
        if (
          this.storage.list().some((x) => x.id !== c.id && sameRemote(remoteUrl(x), remoteUrl(c)))
        )
          throw new MountError('CONFLICT', '这个远程目录已存在，请使用已有连接。')
        await this.storage.save(c, password)
        this.set(c.id, { status: 'disconnected' })
        this.log('configuration-saved', c.id)
      })
    )
  }
  async remove(id: string) {
    return this.serial('configuration', () =>
      this.serial(id, async () => {
        const c = this.config(id)
        if (this.mounts.has(id) || this.match(c, await this.bridge.call<MountInfo[]>('list')))
          throw new MountError('BUSY', '请先卸载远程目录，再删除连接。')
        await this.storage.remove(id)
        this.wanted.delete(id)
        this.states.delete(id)
        this.changed()
        this.log('configuration-removed', id)
      })
    )
  }
  async mount(id: string) {
    return this.serial(id, async () => {
      const c = this.config(id)
      this.wanted.add(id)
      this.set(id, { status: 'connecting' })
      try {
        const current = this.match(c, await this.bridge.call<MountInfo[]>('list'))
        if (current) {
          await this.bridge.call('check', { mount: current, connection: c })
          this.connected(id, current)
          return
        }
        const report = await this.bridge.call<Probe>('probe', { connection: c })
        if (!report.available) throw new MountError('DEPENDENCY', report.warnings.join(' '))
        if (!report.reachable)
          throw new MountError('NETWORK', '无法连接 NAS 服务端口，请检查网络与地址。')
        let password: string
        try {
          password = this.storage.password(id)
        } catch {
          throw new MountError(
            'AUTH',
            '无法解密已保存密码，请解锁系统钥匙串；仍失败时重新保存凭证。'
          )
        }
        const mounted = await this.bridge.call<MountInfo>('mount', { connection: c, password })
        this.connected(id, mounted)
        this.log('mounted', id)
      } catch (e) {
        // 系统可能在调用超时的边界完成挂载；重新核对并实际检查目录，避免重复连接。
        if (failure(e).code === 'TIMEOUT') {
          const current = await this.bridge
            .call<MountInfo[]>('list')
            .then((rows) => this.match(c, rows))
            .catch(() => undefined)
          if (current) {
            try {
              await this.bridge.call('check', { mount: current, connection: c })
              this.connected(id, current)
              return
            } catch {
              /* 离线空壳不作为成功 */
            }
          }
        }
        this.rejected(id, e)
        throw e
      }
    })
  }
  async unmount(id: string) {
    return this.serial(id, async () => {
      const c = this.config(id)
      this.wanted.delete(id)
      this.set(id, { status: 'disconnecting', local: this.mounts.get(id)?.local })
      try {
        const actual = this.match(c, await this.bridge.call<MountInfo[]>('list'))
        if (actual) await this.bridge.call('unmount', { mount: actual, connection: c })
        this.mounts.delete(id)
        this.set(id, { status: 'disconnected' })
        this.log('unmounted', id)
      } catch (e) {
        const rows = await this.bridge.call<MountInfo[]>('list').catch(() => null)
        const actual = rows ? this.match(c, rows) : undefined
        // 只有成功读到挂载表，才能确认卸载成功；枚举失败不能当作“挂载不存在”。
        if (rows && !actual && failure(e).code === 'TIMEOUT') {
          this.mounts.delete(id)
          this.set(id, { status: 'disconnected' })
          return
        }
        this.rejected(id, e)
        throw e
      }
    })
  }
  async probe(id: string) {
    return this.serial(id, () => this.bridge.call<Probe>('probe', { connection: this.config(id) }))
  }
  async local(id: string) {
    const c = this.config(id)
    const actual = this.match(c, await this.bridge.call<MountInfo[]>('list'))
    if (!actual) throw new MountError('NETWORK', '目录尚未挂载，请先连接。')
    await this.bridge.call('check', { mount: actual, connection: c })
    return actual.local + (this.platform === 'win32' ? '\\' : '')
  }
  async refresh() {
    if (this.refreshing) return
    this.refreshing = true
    try {
      const mounts = await this.bridge.call<MountInfo[]>('list')
      for (const c of this.storage.list()) {
        if (this.queues.has(c.id)) continue
        await this.serial(c.id, async () => {
          const actual = this.match(c, mounts)
          const previous = this.states.get(c.id)
          if (actual) {
            try {
              await this.bridge.call('check', { mount: actual, connection: c })
              this.connected(c.id, {
                ...actual,
                readOnly: actual.readOnly || Boolean(previous?.readOnly)
              })
            } catch (e) {
              this.mounts.set(c.id, actual)
              this.rejected(
                c.id,
                new MountError('NETWORK', '挂载仍存在，但目录暂时无法访问；网络恢复后会再次检查。')
              )
            }
          } else {
            const lost = this.mounts.delete(c.id)
            if (lost)
              this.rejected(c.id, new MountError('NETWORK', '系统挂载已断开，正在等待恢复连接。'))
            else if (!previous) this.set(c.id, { status: 'disconnected' })
          }
        })
      }
    } finally {
      this.refreshing = false
    }
  }
  async tick() {
    await this.refresh()
    for (const c of this.storage.list()) {
      const state = this.states.get(c.id)
      if (
        this.wanted.has(c.id) &&
        state?.retryAt &&
        state.retryAt <= Date.now() &&
        !this.queues.has(c.id)
      )
        await this.mount(c.id).catch(() => {})
    }
  }
  async settings(settings: Settings) {
    await this.storage.setSettings(settings)
    if (!settings.reconnect)
      for (const [id, state] of this.states)
        if (state.status === 'retrying')
          this.set(id, { ...state, status: 'error', retryAt: undefined })
    this.changed()
  }
  diagnostics() {
    return JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        session: randomUUID(),
        version: this.version,
        platform: this.platform,
        arch: process.arch,
        connections: this.snapshot().connections.map((x) => ({
          id: x.config.id,
          protocol: x.config.protocol,
          status: x.state.status,
          code: x.state.error?.code,
          readOnly: x.state.readOnly
        })),
        events: this.events
      },
      null,
      2
    )
  }
}
