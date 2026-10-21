import { _electron as electron, expect, test } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, writeFile, rename, unlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { randomUUID } from 'node:crypto'

// 显式开启后仅挂载本机临时 Apache WebDAV；绝不触碰用户已有的 NAS 共享。
test('macOS 原生 WebDAV 真实读写、重命名、枚举与正常卸载', async () => {
  test.skip(
    process.platform !== 'darwin' || process.env.NEXORA_NATIVE_E2E !== '1',
    '通过 NEXORA_NATIVE_E2E=1 显式开启本机原生挂载验收'
  )
  test.setTimeout(120000)
  const root = await mkdtemp(join(tmpdir(), 'nexora-dav-'))
  const site = join(root, 'site')
  const locks = join(root, 'locks')
  const data = join(root, 'app')
  await Promise.all([mkdir(site), mkdir(locks), mkdir(data)])
  const folder = 'Nexora-' + randomUUID().slice(0, 8)
  await mkdir(join(site, folder))
  await writeFile(join(site, folder, 'hello.txt'), 'NAS 原始内容')
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  const conf = join(root, 'httpd.conf')
  await writeFile(
    conf,
    `ServerRoot "${root}"
Listen 127.0.0.1:${port}
ServerName localhost
PidFile "${root}/httpd.pid"
ErrorLog "${root}/error.log"
LoadModule mpm_event_module /usr/libexec/apache2/mod_mpm_event.so
LoadModule unixd_module /usr/libexec/apache2/mod_unixd.so
LoadModule authz_core_module /usr/libexec/apache2/mod_authz_core.so
LoadModule dav_module /usr/libexec/apache2/mod_dav.so
LoadModule dav_fs_module /usr/libexec/apache2/mod_dav_fs.so
User #${process.getuid!()}
Group #${process.getgid!()}
DavLockDB "${locks}/dav"
DocumentRoot "${site}"
<Directory "${site}">
DAV On
Require all granted
</Directory>
`
  )
  const apache = spawn('/usr/sbin/httpd', ['-f', conf, '-DFOREGROUND'], { stdio: 'pipe' })
  let stderr = ''
  apache.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined
  let mounted: string | undefined
  const id = randomUUID()
  try {
    await expect
      .poll(
        async () => {
          if (apache.exitCode !== null) throw new Error(stderr)
          return fetch(`http://127.0.0.1:${port}/${folder}/hello.txt`)
            .then((x) => x.status)
            .catch(() => 0)
        },
        { timeout: 10000 }
      )
      .toBe(200)
    app = await electron.launch({
      args: ['out/main/index.js'],
      env: { ...process.env, NEXORA_E2E: '1', NEXORA_TEST_DATA: data }
    })
    const page = await app.firstWindow()
    await page.evaluate(
      async ({ id, port, folder }) => {
        await window.nexora.save({
          id,
          name: '临时 WebDAV 验收',
          protocol: 'webdav',
          url: `http://127.0.0.1:${port}/${folder}/`,
          username: '',
          autoConnect: false
        })
        try {
          await window.nexora.mount(id)
        } catch (e) {
          throw new Error(
            (e as Error).message +
              JSON.stringify((await window.nexora.snapshot()).connections[0].state)
          )
        }
      },
      { id, port, folder }
    )
    const state = await page.evaluate(
      async () => (await window.nexora.snapshot()).connections[0].state
    )
    expect(state.status).toBe('mounted')
    expect(state.readOnly).toBe(false)
    mounted = state.local
    expect(mounted).toBeTruthy()
    expect(await readFile(join(mounted!, 'hello.txt'), 'utf8')).toBe('NAS 原始内容')
    await writeFile(join(mounted!, '中文 测试.txt'), '通过系统挂载写入')
    await expect
      .poll(() => readFile(join(site, folder, '中文 测试.txt'), 'utf8'))
      .toBe('通过系统挂载写入')
    await rename(join(mounted!, '中文 测试.txt'), join(mounted!, '重命名.txt'))
    expect(await readFile(join(site, folder, '重命名.txt'), 'utf8')).toBe('通过系统挂载写入')
    await unlink(join(mounted!, '重命名.txt'))
    await page.evaluate(async (id) => {
      await window.nexora.refresh()
      await window.nexora.unmount(id)
    }, id)
    expect(
      (await page.evaluate(async () => (await window.nexora.snapshot()).connections[0].state))
        .status
    ).toBe('disconnected')
    mounted = undefined
  } finally {
    // 先卸载本测试创建的卷，再关闭服务器；避免留下不可访问的测试挂载点。
    if (mounted && app) {
      const page = await app.firstWindow()
      await page.evaluate((id) => window.nexora.unmount(id), id).catch(() => {})
    }
    if (app) await app.close()
    apache.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      if (apache.exitCode !== null) resolve()
      else apache.once('exit', () => resolve())
    })
    await rm(root, { recursive: true, force: true })
  }
})
