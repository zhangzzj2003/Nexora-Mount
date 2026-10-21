import koffi from 'koffi'
import { access } from 'node:fs/promises'
import { remoteUrl } from '../../shared/address'
import type { Connection, MountInfo } from '../../shared/types'
import { MountError, nativeError } from '../errors'
import { reachable, type MountAdapter } from './adapter'

export class MacAdapter implements MountAdapter {
  private cf = koffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
  private net = koffi.load('/System/Library/Frameworks/NetFS.framework/NetFS')
  private libc = koffi.load('/usr/lib/libSystem.B.dylib')
  private makeString = this.cf.func(
    'void *CFStringCreateWithCString(void *allocator, const char *text, uint32_t encoding)'
  )
  private makeURL = this.cf.func(
    'void *CFURLCreateWithString(void *allocator, void *string, void *base)'
  )
  private release = this.cf.func('void CFRelease(void *value)')
  private count = this.cf.func('long CFArrayGetCount(void *array)')
  private item = this.cf.func('void *CFArrayGetValueAtIndex(void *array, long index)')
  private length = this.cf.func('long CFStringGetLength(void *string)')
  private toString = this.cf.func(
    'bool CFStringGetCString(void *string, _Out_ uint8_t *buffer, long size, uint32_t encoding)'
  )
  private mountURL = this.net.func(
    'int NetFSMountURLSync(void *url, void *mountpath, void *user, void *password, void *openOptions, void *mountOptions, _Out_ void **mountpoints)'
  )
  private createDict = this.cf.func(
    'void *CFDictionaryCreateMutable(void *allocator, long capacity, void *keys, void *values)'
  )
  private setDict = this.cf.func(
    'void CFDictionarySetValue(void *dictionary, void *key, void *value)'
  )
  private unmountNative = this.libc.func('int unmount(const char *path, int flags)')
  private errno = this.libc.func('int *__error()')
  // 布局来自 macOS SDK 的 __DARWIN_STRUCT_STATFS64，两个目标架构均为 64 位。
  private statfs = koffi.struct('NexoraStatFS', {
    bsize: 'uint32',
    iosize: 'int32',
    blocks: 'uint64',
    bfree: 'uint64',
    bavail: 'uint64',
    files: 'uint64',
    ffree: 'uint64',
    fsid: koffi.array('int32', 2),
    owner: 'uint32',
    type: 'uint32',
    flags: 'uint32',
    subtype: 'uint32',
    fsname: koffi.array('char', 16),
    local: koffi.array('char', 1024),
    remote: koffi.array('char', 1024),
    reserved: koffi.array('uint32', 8)
  })
  private getMounts = this.libc.func(
    process.arch === 'x64' ? 'getmntinfo$INODE64' : 'getmntinfo',
    'int',
    [koffi.out(koffi.pointer(this.statfs, 2)), 'int']
  )
  private string(value: string) {
    return this.makeString(null, value, 0x08000100)
  }
  private decode(value: unknown) {
    const buffer = Buffer.alloc(Number(this.length(value)) * 4 + 1)
    if (!this.toString(value, buffer, buffer.length, 0x08000100))
      throw new MountError('SYSTEM', '无法读取系统挂载路径。')
    return buffer.subarray(0, buffer.indexOf(0)).toString('utf8')
  }
  async probe(c: Connection) {
    return {
      available: true,
      reachable: await reachable(c),
      warnings:
        c.protocol === 'webdav'
          ? [
              'macOS 原生 WebDAV 需要服务端支持 LOCK 才能读写；缺少支持时系统会以只读方式挂载。',
              ...(c.url.startsWith('http:')
                ? ['当前使用 HTTP，内容与认证可能未经加密；建议配置 HTTPS。']
                : [])
            ]
          : []
    }
  }
  async listMounts(): Promise<MountInfo[]> {
    const output: unknown[] = [null]
    const count = this.getMounts(output, 2) // MNT_NOWAIT：枚举不等待离线服务器刷新统计。
    if (!count || !output[0]) return []
    const mounts: MountInfo[] = []
    const text = (x: number[]) => Buffer.from(x).toString('utf8').split('\0')[0]
    for (let i = 0; i < count; i++) {
      const row = koffi.decode(
        output[0] as never,
        i * koffi.sizeof(this.statfs),
        this.statfs
      ) as any
      const protocol = text(row.fsname)
      if (!['smbfs', 'webdav'].includes(protocol)) continue
      let remote = text(row.remote)
      // 系统挂载表可能带用户名；移除它后再向其他进程返回。
      if (protocol === 'smbfs') remote = 'smb:' + remote.replace(/^smb:/, '')
      try {
        const u = new URL(remote)
        u.username = ''
        u.password = ''
        remote = u.href
      } catch {
        continue
      }
      mounts.push({
        remote,
        local: text(row.local),
        protocol: protocol === 'smbfs' ? 'smb' : 'webdav',
        readOnly: Boolean(row.flags & 1)
      })
    }
    return mounts
  }
  async mount(c: Connection, password: string): Promise<MountInfo> {
    const refs: unknown[] = []
    const str = (text: string) => {
      const ref = this.string(text)
      refs.push(ref)
      return ref
    }
    let points: unknown[] = [null]
    try {
      const url = this.makeURL(null, str(remoteUrl(c)), null)
      refs.push(url)
      const options = this.createDict(
        null,
        0,
        this.cf.symbol('kCFTypeDictionaryKeyCallBacks'),
        this.cf.symbol('kCFTypeDictionaryValueCallBacks')
      )
      refs.push(options)
      // 不允许后台连接弹出系统认证窗口；账号错误由应用提供明确反馈。
      this.setDict(options, str('UIOption'), str('NoUI'))
      // 没有账号时显式选择访客，否则 WebDAV 原生客户端会拒绝空用户会话。
      if (!c.username && !password)
        this.setDict(
          options,
          str('Guest'),
          koffi.decode(this.cf.symbol('kCFBooleanTrue'), 'void *')
        )
      const code = this.mountURL(
        url,
        null,
        c.username ? str(c.username) : null,
        password ? str(password) : null,
        options,
        null,
        points
      )
      if (code) throw nativeError(code, 'darwin')
      if (!points[0] || !this.count(points[0]))
        throw new MountError('SYSTEM', '系统未返回挂载位置，请刷新后确认实际连接状态。')
      const local = this.decode(this.item(points[0], 0))
      const actual = (await this.listMounts()).find((x) => x.local === local)
      return actual ?? { remote: remoteUrl(c), local, protocol: c.protocol, readOnly: false }
    } finally {
      if (points[0]) this.release(points[0])
      refs.reverse().forEach((ref) => {
        if (ref) this.release(ref)
      })
    }
  }
  async unmount(m: MountInfo) {
    // 不使用强制卸载，文件占用时把 EBUSY 交还界面。
    if (this.unmountNative(m.local, 0))
      throw nativeError(Number(koffi.decode(this.errno(), 'int')), 'darwin')
  }
  async check(m: MountInfo) {
    await access(m.local)
  }
}
