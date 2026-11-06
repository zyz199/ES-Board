import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import {lingui} from '@lingui/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// https://vitejs.dev/config/
export default defineConfig({
  server: {
    port: 5174,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  plugins: [
    // lingui 宏由 babel 插件编译（@lingui/vite-plugin 只负责 .po 加载）
    react({ babel: { plugins: ['@lingui/babel-plugin-lingui-macro'] } }),
    lingui(),
    tailwindcss(),
  ],
})
