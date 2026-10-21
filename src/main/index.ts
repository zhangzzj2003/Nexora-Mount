import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  powerMonitor,
  safeStorage,
  shell,
  Tray
} from 'electron'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { z } from 'zod'
import { Storage } from './storage'
import { Controller } from './controller'
import { NativeBridge } from './bridge'
import { failure, MountError } from './errors'
import { settingsSchema } from '../shared/types'
import packageInfo from '../../package.json'

let window: BrowserWindow | undefined
let tray: Tray | undefined
let controller: Controller
let bridge: NativeBridge
let quitting = false
const testing = process.env.NEXORA_E2E === '1' && !app.isPackaged
if (testing && process.env.NEXORA_TEST_DATA) app.setPath('userData', process.env.NEXORA_TEST_DATA)

function show() {
  // 窗口销毁后从托盘/系统 Dock 再次打开时重建窗口。
  if (!window || window.isDestroyed()) createWindow()
  window?.show()
  window?.focus()
}
function createWindow() {
  window = new BrowserWindow({
    width: 1140,
    height: 780,
    minWidth: 860,
    minHeight: 640,
    title: 'Nexora Mount',
    backgroundColor: '#f5f7fa',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.on('close', (event) => {
    if (!quitting && controller.snapshot().settings.closeToTray && tray) {
      event.preventDefault()
      window?.hide()
    }
  })
  window.on('closed', () => {
    window = undefined
    if (!quitting && !controller.snapshot().settings.closeToTray) app.quit()
  })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL)
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
}

const lock = app.requestSingleInstanceLock()
if (!lock) app.quit()
else {
  app.on('second-instance', show)
  void app
    .whenReady()
    .then(async () => {
      // safeStorage 密文保存在当前用户目录；原始密码只在挂载时短暂进入系统工作进程。
      const storage = new Storage(app.getPath('userData'), {
        available: () => safeStorage.isEncryptionAvailable(),
        encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
        decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64'))
      })
      try {
        await storage.load()
      } catch (e) {
        dialog.showErrorBox('无法读取配置', (e as Error).message)
        app.quit()
        return
      }
      bridge = new NativeBridge()
      controller = new Controller(storage, bridge, process.platform, packageInfo.version, () => {
        if (window && !window.isDestroyed())
          window.webContents.send('nexora:changed', controller.snapshot())
      })
      // 每个 IPC 方法只接受固定操作和经过验证的参数，禁止界面执行命令或传入任意本地路径。
      const handlers: Record<string, (...args: any[]) => unknown> = {
        snapshot: () => controller.snapshot(),
        save: (input, password) =>
          controller.save(
            input,
            password === undefined ? undefined : z.string().max(4096).parse(password)
          ),
        remove: (id) => controller.remove(z.string().uuid().parse(id)),
        mount: (id) => controller.mount(z.string().uuid().parse(id)),
        unmount: (id) => controller.unmount(z.string().uuid().parse(id)),
        probe: (id) => controller.probe(z.string().uuid().parse(id)),
        open: async (id) => {
          const message = await shell.openPath(await controller.local(z.string().uuid().parse(id)))
          if (message) throw new MountError('SYSTEM', '系统无法打开该目录，请检查挂载状态。')
        },
        refresh: () => controller.refresh(),
        settings: async (input) => {
          const settings = settingsSchema.parse(input)
          const before = controller.snapshot().settings
          const loginChanged = settings.login !== before.login
          if (loginChanged) app.setLoginItemSettings({ openAtLogin: settings.login })
          try {
            await controller.settings(settings)
          } catch (e) {
            if (loginChanged) app.setLoginItemSettings({ openAtLogin: before.login })
            throw e
          }
        },
        diagnostics: () => controller.diagnostics(),
        exportDiagnostics: async (input) => {
          const content = z
            .string()
            .max(1024 * 1024)
            .parse(input)
          const result = await dialog.showSaveDialog(window!, {
            defaultPath: 'nexora-diagnostics.json',
            filters: [{ name: '诊断信息', extensions: ['json'] }]
          })
          if (result.canceled || !result.filePath) return false
          await writeFile(result.filePath, content, { mode: 0o600 })
          return true
        }
      }
      for (const [name, handle] of Object.entries(handlers))
        ipcMain.handle(`nexora:${name}`, async (event, ...args) => {
          try {
            if (
              event.sender !== window?.webContents ||
              event.senderFrame !== window.webContents.mainFrame
            )
              throw new MountError('INVALID', '拒绝未知窗口的请求。')
            return { ok: true, value: await handle(...args) }
          } catch (e) {
            if (
              e instanceof z.ZodError ||
              (name === 'save' && e instanceof Error && !(e instanceof MountError))
            )
              return {
                ok: false,
                error: {
                  code: 'INVALID',
                  message:
                    e instanceof z.ZodError
                      ? '输入格式不正确，请检查连接信息。'
                      : '保存未完成，请检查地址、存储空间及系统钥匙串。'
                }
              }
            return { ok: false, error: failure(e) }
          }
        })
      createWindow()
      // 使用内嵌位图，不依赖网络资源；退出只停止管理与重连，不主动卸载系统卷。
      const icon = nativeImage.createFromBuffer(
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAE50lEQVR4nLVXW2yURRT+zvyXvbcItIUYaqNoSMFE3EAMRF/QZ5+WxEjiCxbKJYEHX/SBVF9MFDCRrUjg3dDEFyUxMcFEMaLSEhMoJgJSRUrl1tLtXv79Z46Z+f+t2+12u1v0S/7sXL4958yZM2fmEKqQyZy2hoa2S91O97HjJP5M6bb0coQlwHKTDLThYdvN3OjABs8MHmKBAVIVDs2ymQlEvGnPHy8pYe2EkpvBahnANDvfCog4bDBITJGwLyjfOzVyvOdsIDOYJ93JZIaEXnm6//pRy0kdgLDAfhHMs4Y+EogEyI4CrCDLM9nhbPf+zHatM6Mok2FraIjkxl3XjkaSqw54+QkJ1ibqfzFB20mAIEDpdtivi4W4TMxaOwhuotMu525/MvzpU3v0lhtR6V03tlrRxDlZnimDla1trpWbLyrEXAFLBP2F0JjLDAjfiqQcv/hg28jxtWeFGRZqL5HFrBTNUR62EhGBD3d1oWeVjbKsNa8VLhGz1gEmEvv0iOg9dMklpk3KL5JxexW0K2eKjOm8wraNcSNsMifNeC2a5RJgaV3a8em+C3GRuCtSALebgNN7XiWwWGJsXhfF4d2diLqEt19biVe3JFEo8RzBrXCDmDDBnRL2ijbRaC81+d03VuK5tRF8eT6Hle0WPujrRHtSoCx51r2tcOd5DgsZwIBtkRHw2TfTyLz3Fz76/D5chxBxKIjyJXCbNqAiWCogFiG0JwQSUWHG6glshdu0AUSAYwFKBQr0rx4LDu/SudWwGyn3PMbvt33seLkNWzfEsHq5jbtTErkCw6qKrGru69sac1vygGMTDg5O4Kdfi1i3xsXfkz52HhlH3lNBkuH53ItXA+74vTJ2Hq7PbcoAZpgAujZexveXC6Z/+UYJF6+WEHNpjsBq7vkr+g4Bfrlen9uSBzgUnIjoixKIuIR4pL7ACjcecqMNuE0boFEdyYtFdSvcpg2ohl7ZQgmlmfklG8AcfJ7PkDJIvfME6StYASWPTWZczPVNG8AMk9H0ytaudrEsKZCvye96rlhmk4Sefzpq0r2Ol2aMEI2VB0K/u5Q3Stf3RJDdv8pkOe2Nyj77EuaoHe3vxIvPxkxGPHN+Bo6zuBG0ae/oCiWjV8hyO1h5XLuLWvDUjMKW9TEc29eFeFRg/L6PyVxwvjW0wmRMYE2HDV8y3jpxB2d+zOGxpDBztcsi4RCr8gNB1LtgJqxAC9BuP3epgP3HJnCkv8tkudXL53MLHuOdU3fwhb4N24TxzGKwF6cELtar+WG0gB3v30JPl2NcO3sdh+1b93yMjpWwItWc8qYNmHVzXGBsoozfbnrhw2IuR6fjVLye2xsY8EDYuXaFh0Sig1m/4Rd885pjprOdTq/1ULkFG8K8lM1VnVPSfSiufvxMCeBhYUfDp/Mi/w/v/XpfM5mPQVLrAtHI8InH8yaOFTlZ/VolEmHK+d/ARKbmIBIiqweELg4uDnZ/K0uTg068w2EmyczSJAH8Rx8bGLlOvNMpF++fGs4+8XVYmISl2emMSu8Zy1puql9HgfKLldfro4MEhC7NQJDe9Mkn73Tv7u0FDwxUCs/QO/pdnt479gqR/SazSkP5/xanS9fOIGtKCGsESp78ebD7q6rirkZ4Ven8wkGOsZxoU37hkQwQdoz9opzWAVelo1I54h8Q4cmRt+3TbAAAAABJRU5ErkJggg==',
          'base64'
        )
      )
      tray = new Tray(icon)
      tray.setToolTip('Nexora Mount')
      tray.setContextMenu(
        Menu.buildFromTemplate([
          { label: '打开 Nexora Mount', click: show },
          {
            label: '刷新连接状态',
            click: () => {
              void controller.tick().catch(() => {})
            }
          },
          { type: 'separator' },
          { label: '退出（保留挂载）', click: () => app.quit() }
        ])
      )
      tray.on('click', show)
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === 'darwin'
            ? [
                {
                  label: 'Nexora Mount',
                  submenu: [
                    { role: 'about' as const },
                    { type: 'separator' as const },
                    { role: 'hide' as const },
                    { role: 'quit' as const }
                  ]
                }
              ]
            : []),
          {
            label: '编辑',
            submenu: [
              { role: 'undo' },
              { role: 'redo' },
              { type: 'separator' },
              { role: 'cut' },
              { role: 'copy' },
              { role: 'paste' },
              { role: 'selectAll' }
            ]
          }
        ])
      )
      const timer = setInterval(() => {
        void controller.tick().catch(() => {})
      }, 5000)
      const wake = () => {
        void controller.tick().catch(() => {})
      }
      powerMonitor.on('resume', wake)
      app.on('before-quit', () => {
        quitting = true
        clearInterval(timer)
        bridge.close()
      })
      app.on('activate', show)
      await controller.initialize().catch(() => {})
    })
    .catch(() => {
      dialog.showErrorBox('启动失败', '应用初始化失败，请检查安装文件与当前用户的应用数据目录。')
      app.quit()
    })
}
