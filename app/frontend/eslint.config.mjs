// ESLint flat config：TypeScript 版（typescript-eslint）。
// 未使用变量降级为 warn 以避免迁移期噪音；no-explicit-any 关闭（ES 动态响应体本就是 any）。
import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'wailsjs/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}', 'test/**/*.ts'],
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly', document: 'readonly', localStorage: 'readonly',
        navigator: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly',
        setInterval: 'readonly', clearInterval: 'readonly', console: 'readonly',
        requestAnimationFrame: 'readonly', cancelAnimationFrame: 'readonly',
        performance: 'readonly',
        fetch: 'readonly', FileReader: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
        FormData: 'readonly', Blob: 'readonly', history: 'readonly',
        go: 'readonly', runtime: 'readonly', // Wails 桥注入
      },
    },
    rules: {
      // 类型检查交给 tsc，eslint 只兜代码质量问题
      'no-undef': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
)
