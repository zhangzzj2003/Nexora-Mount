import { isIP } from 'node:net'
import { connectionSchema, type Connection } from './types'

export function validateConnection(input: unknown): Connection {
  const c = connectionSchema.parse(input)
  if (c.protocol === 'smb') {
    // 共享只接受单个共享名；路径分隔符、凭证和端口不能混入主机字段。
    if (
      /[\s/@\\?#\u0000-\u001f]/.test(c.host) ||
      (c.host.includes(':') && !isIP(c.host.replace(/^\[|\]$/g, '')))
    )
      throw new Error('请输入主机名或 IP，端口使用 SMB 默认值 445。')
    if (/[\\/\u0000-\u001f]/.test(c.share) || ['.', '..'].includes(c.share))
      throw new Error('共享名不能包含路径分隔符。')
  } else {
    const url = new URL(c.url)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error('请输入不含凭证、查询参数或片段的 HTTP/HTTPS 地址。')
    if (/%(?:00|0a|0d|2f|5c)/i.test(url.pathname) || /[\u0000-\u001f\\]/.test(c.url))
      throw new Error('WebDAV 路径包含不支持的转义字符。')
    try {
      decodeURIComponent(url.pathname)
    } catch {
      throw new Error('WebDAV 路径的百分号编码不完整，请检查地址。')
    }
    c.url = url.href.replace(/\/$/, '') + '/'
  }
  return c
}

export function remoteUrl(c: Connection): string {
  if (c.protocol === 'webdav') return c.url
  const host = c.host.replace(/^\[|\]$/g, '')
  return `smb://${host.includes(':') ? `[${host}]` : host}/${encodeURIComponent(c.share)}`
}

export function windowsRemote(c: Connection): string {
  if (c.protocol === 'smb') {
    const host = c.host.includes(':')
      ? c.host.replace(/^\[|\]$/g, '').replace(/:/g, '-') + '.ipv6-literal.net'
      : c.host
    return `\\\\${host}\\${c.share}`
  }
  const u = new URL(c.url)
  const secure = u.protocol === 'https:' ? '@SSL' : ''
  const port = u.port ? `@${u.port}` : ''
  const host = u.hostname.includes(':')
    ? u.hostname.replace(/^\[|\]$/g, '').replace(/:/g, '-') + '.ipv6-literal.net'
    : u.hostname
  return `\\\\${host}${secure}${port}\\DavWWWRoot${decodeURIComponent(u.pathname).replace(/\//g, '\\')}`.replace(
    /\\$/,
    ''
  )
}

export function sameRemote(a: string, b: string): boolean {
  // SMB 共享名不区分大小写；WebDAV 路径保留大小写，避免混淆不同目录。
  const normalize = (s: string) => {
    try {
      const u = new URL(s)
      u.username = ''
      u.password = ''
      const path = decodeURIComponent(u.pathname).replace(/\/$/, '')
      return `${u.protocol}//${u.host.toLowerCase()}${u.protocol === 'smb:' ? path.normalize('NFC').toLowerCase() : path}`
    } catch {
      return s.replace(/\\$/, '').toLowerCase()
    }
  }
  return normalize(a) === normalize(b)
}
