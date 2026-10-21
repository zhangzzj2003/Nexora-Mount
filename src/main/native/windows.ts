import koffi from 'koffi'
import { access } from 'node:fs/promises'
import type { Connection, MountInfo, Probe } from '../../shared/types'
import { windowsRemote } from '../../shared/address'
import { MountError, nativeError } from '../errors'
import { reachable, type MountAdapter } from './adapter'

export class WindowsAdapter implements MountAdapter {
  private mpr = koffi.load('mpr.dll')
  private kernel = koffi.load('kernel32.dll')
  private adv = koffi.load('advapi32.dll')
  private resource = koffi.struct('NexoraNETRESOURCEW', {
    scope: 'uint32',
    type: 'uint32',
    displayType: 'uint32',
    usage: 'uint32',
    local: 'str16',
    remote: 'str16',
    comment: 'str16',
    provider: 'str16'
  })
  private add = this.mpr.func('WNetAddConnection2W', 'uint32', [
    koffi.pointer(this.resource),
    'str16',
    'str16',
    'uint32'
  ])
  private cancel = this.mpr.func(
    'uint32 WNetCancelConnection2W(const char16_t *name, uint32 flags, int force)'
  )
  private get = this.mpr.func(
    'uint32 WNetGetConnectionW(const char16_t *local, _Out_ uint8_t *remote, _Inout_ uint32_t *length)'
  )
  private drives = this.kernel.func('uint32 GetLogicalDrives()')
  private openSCM = this.adv.func(
    'void *OpenSCManagerW(const char16_t *machine, const char16_t *database, uint32 access)'
  )
  private openService = this.adv.func(
    'void *OpenServiceW(void *manager, const char16_t *name, uint32 access)'
  )
  private closeService = this.adv.func('int CloseServiceHandle(void *handle)')
  private status = this.adv.func(
    'int QueryServiceStatusEx(void *service, int level, _Out_ uint8_t *data, uint32 size, _Out_ uint32_t *needed)'
  )
  private regGet = this.adv.func(
    'int32 RegGetValueW(void *key, const char16_t *subkey, const char16_t *value, uint32 flags, void *type, _Out_ uint32_t *data, _Inout_ uint32_t *size)'
  )
  private volume = this.kernel.func(
    'int GetVolumeInformationW(const char16_t *root, void *name, uint32 nameSize, void *serial, void *maxComponent, _Out_ uint32_t *flags, void *fsName, uint32 fsNameSize)'
  )
  async probe(c: Connection): Promise<Probe> {
    const report: Probe = { available: true, reachable: await reachable(c), warnings: [] }
    if (c.protocol !== 'webdav') return report
    const manager = this.openSCM(null, null, 1)
    if (!manager) throw new MountError('DEPENDENCY', '无法查询 Windows 服务，请检查当前用户权限。')
    try {
      const service = this.openService(manager, 'WebClient', 4)
      if (!service) {
        report.available = false
        report.warnings.push('未找到或无法访问 WebClient 服务，当前系统无法原生挂载 WebDAV。')
      } else {
        try {
          const buffer = Buffer.alloc(36)
          if (!this.status(service, 0, buffer, buffer.length, [0]))
            throw new MountError('DEPENDENCY', '无法读取 WebClient 服务状态。')
          if (buffer.readUInt32LE(4) !== 4)
            report.warnings.push(
              'WebClient 服务尚未运行；若系统未自动启动，请按说明在服务管理器中启用。'
            )
        } finally {
          this.closeService(service)
        }
      }
    } finally {
      this.closeService(manager)
    }
    const value = [50000000]
    // 只读取系统限制，不自动修改注册表或重启用户的系统服务。
    const configured = this.regGet(
      0xffffffff80000002n,
      'SYSTEM\\CurrentControlSet\\Services\\WebClient\\Parameters',
      'FileSizeLimitInBytes',
      0x10,
      null,
      value,
      [4]
    )
    if (configured !== 0) value[0] = 50000000
    report.maxFileBytes = value[0]
    report.warnings.push(
      `Windows WebDAV 当前单文件限制约 ${(value[0] / 1024 / 1024).toFixed(1)} MiB。WebClient 已被微软标记为弃用。`
    )
    if (c.url.startsWith('http:'))
      report.warnings.push('HTTP 未加密，且系统可能拒绝通过 HTTP 发送账号密码；请优先配置 HTTPS。')
    return report
  }
  async listMounts(): Promise<MountInfo[]> {
    const mounts: MountInfo[] = []
    for (let code = 68; code <= 90; code++) {
      const local = String.fromCharCode(code) + ':'
      const buffer = Buffer.alloc(65536)
      const status = this.get(local, buffer, [32768])
      // 1201 表示映射仍保留但服务器暂时不可用；不能误判成盘符已释放。
      if (status && status !== 1201) continue
      const remote = buffer.toString('utf16le').split('\0')[0]
      if (!remote) continue
      // 不访问远程卷来枚举，避免一个离线连接拖住所有连接的状态刷新。
      mounts.push({
        local,
        remote,
        protocol: /\\DavWWWRoot(?:\\|$)/i.test(remote) ? 'webdav' : 'smb',
        readOnly: false
      })
    }
    return mounts
  }
  async mount(c: Connection, password: string): Promise<MountInfo> {
    const occupied = this.drives()
    const local =
      c.drive ??
      Array.from({ length: 23 }, (_, i) => String.fromCharCode(90 - i) + ':').find(
        (x) => !(occupied & (1 << (x.charCodeAt(0) - 65)))
      )
    if (!local || occupied & (1 << (local.charCodeAt(0) - 65)))
      throw new MountError('CONFLICT', '指定盘符已被占用或没有可用盘符，请选择其他位置。')
    const remote = windowsRemote(c)
    const code = this.add(
      { scope: 0, type: 1, displayType: 0, usage: 0, local, remote, comment: null, provider: null },
      password || null,
      c.username || null,
      0
    )
    if (code) throw nativeError(code, 'win32')
    const flags = [0]
    this.volume(local + '\\', null, 0, null, null, flags, null, 0)
    return { remote, local, protocol: c.protocol, readOnly: Boolean(flags[0] & 0x80000) }
  }
  async unmount(m: MountInfo) {
    const code = this.cancel(m.local, 0, 0)
    if (code) throw nativeError(code, 'win32')
  }
  async check(m: MountInfo) {
    await access(m.local + '\\')
  }
}
