import type { Connection } from '../../src/shared/types'
// 测试只使用保留的 .invalid 域名，避免访问或改动真实 NAS。
export const smb: Connection = {
  id: '3f11e425-2904-457a-b7ba-80d12b188f61',
  protocol: 'smb',
  name: '工作 NAS',
  host: 'nas.invalid',
  share: '项目 文件',
  username: '',
  autoConnect: false
}
export const dav: Connection = {
  id: '3f11e425-2904-457a-b7ba-80d12b188f62',
  protocol: 'webdav',
  name: 'WebDAV',
  url: 'https://nas.invalid:5006/dav/项目/',
  username: '',
  autoConnect: false
}
