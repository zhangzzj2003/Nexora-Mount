import type { Failure } from '../shared/types'

export class MountError extends Error {
  constructor(
    public code: Failure['code'],
    message: string,
    public detail?: string
  ) {
    super(message)
  }
}
export function failure(e: unknown): Failure {
  if (e instanceof MountError) return { code: e.code, message: e.message, detail: e.detail }
  // 未知原生异常可能带远程地址或凭证，只向界面提供固定错误消息。
  return { code: 'SYSTEM', message: '操作未完成，请检查连接设置或导出诊断信息。' }
}
export function nativeError(code: number, platform: string): MountError {
  if (platform === 'win32' && [12037, 12038, 12045, 12175].includes(code))
    return new MountError(
      'CERTIFICATE',
      'HTTPS 证书验证失败，请检查证书域名、有效期与系统信任。',
      String(code)
    )
  if (platform === 'darwin' && code === -6004)
    return new MountError(
      'AUTH',
      '服务器不允许访客访问，请填写有共享权限的账号密码。',
      String(code)
    )
  if (
    (platform === 'win32' && [5, 86, 1326, 1909].includes(code)) ||
    (platform === 'darwin' && [13, 80, -5000, -5023, -5999, -5045, -5046].includes(code))
  )
    return new MountError('AUTH', '认证失败，请检查账号、密码和共享权限。', String(code))
  if (
    (platform === 'win32' && [85, 1219, 1202].includes(code)) ||
    (platform === 'darwin' && code === 17)
  )
    return new MountError(
      'CONFLICT',
      '挂载位置已占用，或同一服务器已有其他账号的连接。请先检查系统中的连接。',
      String(code)
    )
  if (
    (platform === 'win32' && [170, 2401, 2404].includes(code)) ||
    (platform === 'darwin' && code === 16)
  )
    return new MountError('BUSY', '文件夹正在使用中，请关闭相关文件和终端后再卸载。', String(code))
  if (platform === 'win32' && code === 223)
    return new MountError(
      'SYSTEM',
      '文件超出 Windows WebDAV 当前大小限制，请查看 WebDAV 配置说明。',
      String(code)
    )
  if (
    (platform === 'win32' && [53, 64, 67, 1203, 1231, 1232, 1201].includes(code)) ||
    (platform === 'darwin' && [2, 6, 19, 50, 51, 60, 61, 64, 65, -6602].includes(code))
  )
    return new MountError(
      'NETWORK',
      '无法访问远程目录，请检查网络、地址及 NAS 服务。',
      String(code)
    )
  if (platform === 'darwin' && [-1200, -1202, -1203, -1204, -1205, -1206].includes(code))
    return new MountError(
      'CERTIFICATE',
      'HTTPS 证书验证失败，请检查域名、有效期与系统证书信任。',
      String(code)
    )
  return new MountError(
    'SYSTEM',
    '系统未能完成挂载操作，请检查协议支持和服务器设置。',
    String(code)
  )
}
