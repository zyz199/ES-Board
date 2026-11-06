import { i18n } from '@lingui/core'
import { compileMessage } from '@lingui/message-utils/compileMessage'
import { flattenCatalog } from './utils/i18nCatalog'
import zhCN from './locales/zh-CN/messages.json'
import en from './locales/en/messages.json'

export const SUPPORTED = ['zh-CN', 'en']

// 目录由 `pnpm i18n:extract` 生成/维护，加载时的取词规则见 utils/i18nCatalog.ts
i18n.load({
  'zh-CN': flattenCatalog(zhCN),
  en: flattenCatalog(en),
})

// 目录是运行时加载的原始字符串（ICU 格式），必须显式注册消息编译器：
// @lingui/core 的内置编译器在生产构建中会被 tree-shake 掉，
// 不注册的话 prod 下占位符（{count} 等）不会被替换，直接渲染原始模板
i18n.setMessagesCompiler(compileMessage)

export function detectLocale() {
  const lang = navigator.language || 'zh-CN'
  if (lang.startsWith('zh')) return 'zh-CN'
  return 'en'
}

export function setLocale(locale: string) {
  if (!SUPPORTED.includes(locale)) return
  i18n.activate(locale)
}

export default i18n
