import { expect, it } from 'vitest'
import { WindowsAdapter } from '../../src/main/native/windows'

// Windows CI 读取真实系统盘符映射，提前发现 DLL 符号或 FFI 声明错误。
it.skipIf(process.platform !== 'win32')('Windows 原生网络盘符可枚举', async () => {
  expect(await new WindowsAdapter().listMounts()).toBeInstanceOf(Array)
})
