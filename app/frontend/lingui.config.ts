import { defineConfig } from '@lingui/conf'
import { formatter } from '@lingui/format-json'

export default defineConfig({
  sourceLocale: 'en',
  locales: ['en', 'zh-CN'],
  catalogs: [
    {
      path: 'src/locales/{locale}/messages',
      include: ['src'],
    },
  ],
  // CLI 5.x 起 JSON 格式从 @lingui/cli 拆成独立包，且不再接受字符串：
  // 'json' 报 Unknown format，'lingui' 会提示改用 @lingui/format-json。
  // style: 'lingui' 即结构化 JSON { "<源文本>": { translation, origin, ... } }，
  // 与 src/locales/*/messages.json 现有结构一致，i18n.js 的加载逻辑无需改动。
  // origins 记录「消息被哪些文件引用」，便于排查未使用/缺失的词条；
  // 关掉 lineNumbers，避免行号变动产生无谓 diff。
  format: formatter({ style: 'lingui', origins: true, lineNumbers: false }),
})
