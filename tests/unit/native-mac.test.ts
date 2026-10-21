import { expect, it } from 'vitest'
import { MacAdapter } from '../../src/main/native/mac'

// 本机实测 FFI 的符号、结构体布局与挂载枚举；不创建、卸载或修改任何现有挂载。
it.skipIf(process.platform !== 'darwin')('macOS 原生挂载表可读取', async () => {
  const adapter = new MacAdapter()
  expect(await adapter.listMounts()).toBeInstanceOf(Array)
})
