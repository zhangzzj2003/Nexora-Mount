import { describe, expect, it } from 'vitest'
import { validateConnection, remoteUrl, sameRemote, windowsRemote } from '../../src/shared/address'
import type { Connection } from '../../src/shared/types'

export const smb: Connection = {
  id: '3f11e425-2904-457a-b7ba-80d12b188f61',
  protocol: 'smb',
  name: '工作 NAS',
  host: 'nas.local',
  share: '项目 文件',
  username: '',
  autoConnect: false
}
export const dav: Connection = {
  id: '3f11e425-2904-457a-b7ba-80d12b188f62',
  protocol: 'webdav',
  name: 'WebDAV',
  url: 'https://nas.local:5006/dav/项目/',
  username: '',
  autoConnect: false
}
describe('地址与协议边界', () => {
  it('正确构造中文 SMB 和 IPv6 地址', () => {
    expect(remoteUrl(smb)).toBe('smb://nas.local/%E9%A1%B9%E7%9B%AE%20%E6%96%87%E4%BB%B6')
    expect(windowsRemote(smb)).toBe('\\\\nas.local\\项目 文件')
    expect(remoteUrl({ ...smb, host: 'fe80::1' })).toContain('[fe80::1]')
  })
  it('保留 WebDAV 子路径并生成 SSL UNC', () => {
    expect(windowsRemote(dav)).toBe('\\\\nas.local@SSL@5006\\DavWWWRoot\\dav\\项目')
    expect(validateConnection(dav).protocol).toBe('webdav')
  })
  it.each([
    'https://user:secret@nas.local/dav/',
    'file:///tmp/dav',
    'https://nas.local/dav/?token=secret',
    'https://nas.local/a%2fb'
  ])('拒绝凭证混入及不受支持 URL：%s', (url) => {
    expect(() => validateConnection({ ...dav, url })).toThrow()
  })
  it('拒绝共享名路径注入和主机凭证', () => {
    expect(() => validateConnection({ ...smb, share: '../secret' })).toThrow()
    expect(() => validateConnection({ ...smb, host: 'user@host' })).toThrow()
  })
  it('匹配系统用户名、转义和尾斜杠，但保留 URL 路径大小写', () => {
    expect(sameRemote('smb://alice@NAS.local/%E9%A1%B9%E7%9B%AE/', 'smb://nas.local/项目')).toBe(
      true
    )
    expect(sameRemote('https://nas.local/Work', 'https://nas.local/work')).toBe(false)
    expect(sameRemote('smb://NAS.local/Projects', 'smb://nas.local/projects/')).toBe(true)
  })
})
