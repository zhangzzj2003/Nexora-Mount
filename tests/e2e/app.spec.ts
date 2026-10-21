import { _electron as electron, expect, test } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'

test('桌面连接管理、原生枚举、输入验证与诊断', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nexora-desktop-'))
  // 使用已释放的本机端口验证网络失败，避免代理软件把 .invalid 解析成可连接的假 IP。
  const reservation = createServer()
  await new Promise<void>((resolve) => reservation.listen(0, '127.0.0.1', resolve))
  const closedPort = (reservation.address() as { port: number }).port
  await new Promise<void>((resolve) => reservation.close(() => resolve()))
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, NEXORA_E2E: '1', NEXORA_TEST_DATA: directory }
  })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await expect(page.getByRole('heading', { name: '让工作，连接起来。' })).toBeVisible()
    await page.getByRole('button', { name: '添加连接', exact: true }).click()
    await page.getByLabel('连接名称', { exact: true }).fill('项目 NAS')
    await page.getByLabel('主机名或 IP').fill('nas.invalid')
    await page.getByLabel('共享名称').fill('工作项目')
    await page.getByRole('button', { name: '保存连接', exact: true }).click()
    await expect(page.getByRole('heading', { name: '项目 NAS', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '添加连接', exact: true }).click()
    await page.getByRole('button', { name: 'WebDAV', exact: true }).click()
    await page.getByLabel('连接名称', { exact: true }).fill('远程资料')
    await page.getByLabel('WebDAV 地址').fill(`http://127.0.0.1:${closedPort}/dav/资料/`)
    await page.getByRole('button', { name: '保存连接', exact: true }).click()
    await expect(page.getByRole('heading', { name: '远程资料', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '连接目录', exact: true }).click()
    await expect(page.getByText('无法连接 NAS 服务端口，请检查网络与地址。').first()).toBeVisible({
      timeout: 15000
    })
    await page.getByRole('button', { name: '编辑', exact: true }).click()
    await page.getByLabel('连接名称', { exact: true }).fill('资料 WebDAV')
    await page.getByRole('button', { name: '保存连接', exact: true }).click()
    await expect(page.getByRole('heading', { name: '资料 WebDAV', exact: true })).toBeVisible()
    await page.getByRole('button', { name: '连接诊断', exact: true }).click()
    await expect(page.getByLabel('诊断信息预览')).toHaveValue(/generatedAt/)
    const diagnostics = await page.getByLabel('诊断信息预览').inputValue()
    expect(JSON.parse(diagnostics).connections).toHaveLength(2)
    expect(diagnostics).not.toContain('nas.invalid')
    await page.getByRole('button', { name: '偏好设置', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'WebDAV 使用说明' })).toBeVisible()
    await page.getByRole('button', { name: /我的连接/ }).click()
    await page.getByRole('button', { name: /项目 NAS smb:/ }).click()
    await page.screenshot({ path: join(directory, 'desktop.png') })
    await page.screenshot({ path: join(tmpdir(), 'nexora-mount-preview.png') })
    const persisted = JSON.parse(await readFile(join(directory, 'connections.json'), 'utf8'))
    expect(persisted.connections).toHaveLength(2)
    // 确认生产渲染进程不能获取 Node.js，所有桌面请求经过 preload。
    expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined')
    expect(errors).toEqual([])
    // 关闭到托盘保留原窗口，再次打开仍可继续管理连接。
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect
      .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()))
      .toBe(false)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].show())
    await expect(page.getByRole('heading', { name: '让工作，连接起来。' })).toBeVisible()
  } finally {
    await app.close()
    await rm(directory, { recursive: true, force: true })
  }
})
