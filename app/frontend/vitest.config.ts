import {defineConfig} from 'vitest/config'

// 独立的 vitest 配置：不带 vite.config.ts 中的 lingui/react 插件，
// 单测只覆盖纯逻辑，无需编译 JSX 宏
export default defineConfig({
  test: {
    environment: 'node',
    // 单测统一收口在 test/ 目录，按 src 的目录结构镜像组织（如 test/utils/）
    include: ['test/**/*.test.{js,jsx,ts,tsx}'],
  },
})
