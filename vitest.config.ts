import { defineConfig } from 'vitest/config'
// 真实系统接口另由 Electron 验证；单元测试聚焦可重复的状态与安全边界。
export default defineConfig({ test: { include: ['tests/unit/**/*.test.ts'] } })
