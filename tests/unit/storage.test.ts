import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Storage } from '../../src/main/storage'
import { smb, dav } from './fixtures'

const paths: string[] = []
const cipher = {
  available: () => true,
  encrypt: (x: string) => Buffer.from(x).toString('base64'),
  decrypt: (x: string) => Buffer.from(x, 'base64').toString()
}
async function setup() {
  const path = await mkdtemp(join(tmpdir(), 'nexora-storage-'))
  paths.push(path)
  const store = new Storage(path, cipher)
  await store.load()
  return { store, path }
}
afterEach(async () => {
  await Promise.all(paths.splice(0).map((p) => rm(p, { recursive: true, force: true })))
})
describe('配置事务与凭证边界', () => {
  it('串行保存不丢连接，凭证交给加密接口并可重启读取', async () => {
    const { store, path } = await setup()
    await Promise.all([store.save(smb, 'secret-value'), store.save(dav)])
    const text = await readFile(join(path, 'connections.json'), 'utf8')
    expect(text).not.toContain('secret-value')
    const reload = new Storage(path, cipher)
    await reload.load()
    expect(reload.list()).toHaveLength(2)
    expect(reload.password(smb.id)).toBe('secret-value')
  })
  it('密码留空保留，显式清除删除密文，更换账号不复用旧密码', async () => {
    const { store } = await setup()
    await store.save(smb, 'secret')
    await store.save({ ...smb, name: '新名称' })
    expect(store.password(smb.id)).toBe('secret')
    await store.save({ ...smb, username: 'other' })
    expect(store.hasPassword(smb.id)).toBe(false)
    await store.save(smb, 'secret')
    await store.save(smb, '')
    expect(store.hasPassword(smb.id)).toBe(false)
  })
  it('配置损坏不覆盖原文件', async () => {
    const { path } = await setup()
    const file = join(path, 'connections.json')
    await writeFile(file, 'broken')
    await expect(new Storage(path, cipher).load()).rejects.toThrow('配置文件损坏')
    expect(await readFile(file, 'utf8')).toBe('broken')
  })
  it('系统加密不可用时拒绝保存密码', async () => {
    const { path } = await setup()
    const store = new Storage(path, { ...cipher, available: () => false })
    await store.load()
    await expect(store.save(smb, 'secret')).rejects.toThrow('加密当前不可用')
    expect(store.list()).toEqual([])
  })
})
