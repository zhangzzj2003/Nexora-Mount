import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  DEFAULT_SETTINGS,
  connectionSchema,
  settingsSchema,
  type Connection,
  type Settings
} from '../shared/types'

const schema = z.object({
  version: z.literal(1),
  connections: z.array(connectionSchema),
  secrets: z.record(z.string(), z.string()),
  settings: settingsSchema
})
export interface Cipher {
  available(): boolean
  encrypt(value: string): string
  decrypt(value: string): string
}
export class Storage {
  private data = {
    version: 1 as const,
    connections: [] as Connection[],
    secrets: {} as Record<string, string>,
    settings: { ...DEFAULT_SETTINGS }
  }
  private queue: Promise<unknown> = Promise.resolve()
  constructor(
    private directory: string,
    private cipher: Cipher
  ) {}
  async load() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    try {
      this.data = schema.parse(
        JSON.parse(await readFile(join(this.directory, 'connections.json'), 'utf8'))
      )
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('配置文件损坏，已保留原文件，请备份后修复 connections.json。')
    }
  }
  list() {
    return structuredClone(this.data.connections)
  }
  settings() {
    return { ...this.data.settings }
  }
  hasPassword(id: string) {
    return Boolean(this.data.secrets[id])
  }
  password(id: string) {
    const value = this.data.secrets[id]
    return value ? this.cipher.decrypt(value) : ''
  }
  private change(update: (next: typeof this.data) => void) {
    const run = this.queue
      .catch(() => {})
      .then(async () => {
        const next = structuredClone(this.data)
        update(next)
        // 先写临时文件再原子替换；落盘失败时内存仍保留旧配置，避免反馈与实际不一致。
        const path = join(this.directory, 'connections.json')
        await writeFile(path + '.tmp', JSON.stringify(next, null, 2), { mode: 0o600 })
        await rename(path + '.tmp', path)
        this.data = next
      })
    this.queue = run
    return run
  }
  save(c: Connection, password?: string) {
    return this.change((next) => {
      if (password !== undefined) {
        if (password && !this.cipher.available())
          throw new Error('系统凭证加密当前不可用，请解锁钥匙串后再试。')
        if (password) next.secrets[c.id] = this.cipher.encrypt(password)
        else delete next.secrets[c.id]
      }
      const previous = next.connections.find((x) => x.id === c.id)
      // 更换账号却没有提供新密码时，不能继续使用旧账号的密码。
      if (previous && previous.username !== c.username && password === undefined)
        delete next.secrets[c.id]
      next.connections = [...next.connections.filter((x) => x.id !== c.id), c]
    })
  }
  remove(id: string) {
    return this.change((next) => {
      next.connections = next.connections.filter((x) => x.id !== id)
      delete next.secrets[id]
    })
  }
  setSettings(settings: Settings) {
    return this.change((next) => {
      next.settings = settings
    })
  }
}
