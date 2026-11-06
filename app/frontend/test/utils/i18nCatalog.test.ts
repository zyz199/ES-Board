import { describe, expect, it } from 'vitest'
import { generateMessageId } from '@lingui/message-utils/generateMessageId'
import { flattenCatalog } from '../../src/utils/i18nCatalog'
import zhCN from '../../src/locales/zh-CN/messages.json'
import en from '../../src/locales/en/messages.json'

describe('flattenCatalog', () => {
  it('按 msgid 取译文', () => {
    expect(flattenCatalog({ abc123: { translation: '你好' } }).abc123).toBe('你好')
  })

  it('未翻译时回落到 message（英文原文），而不是把哈希 id 当文案', () => {
    const out = flattenCatalog({ abc123: { translation: '', message: 'Hello' } })
    expect(out.abc123).toBe('Hello')
  })

  it('translation 与 message 都缺时回落到 id（源文本条目）', () => {
    expect(flattenCatalog({ 'No data': {} })['No data']).toBe('No data')
  })

  it('源文本 key 会同时注册到它的哈希 id 上（兼容 i18n._ 字面量调用）', () => {
    const out = flattenCatalog({ Docs: { translation: '文档' } })
    expect(out[generateMessageId('Docs')]).toBe('文档')
  })

  it('源文本 key 不会覆盖已存在的哈希条目', () => {
    const hash = generateMessageId('Docs')
    const out = flattenCatalog({
      Docs: { translation: '错的' },
      [hash]: { translation: '对的' },
    })
    expect(out[hash]).toBe('对的')
  })
})

describe.each([
  ['zh-CN', zhCN],
  ['en', en],
])('真实 catalog (%s)', (locale, catalog) => {
  const flat = flattenCatalog(catalog)

  it('非空', () => {
    expect(Object.keys(catalog).length).toBeGreaterThan(0)
  })

  it('没有条目会把哈希 msgid 原样渲染出来', () => {
    const garbled = Object.keys(catalog).filter(
      (key) => /^[A-Za-z0-9_-]{6}$/.test(key) && flat[key] === key,
    )
    expect(garbled).toEqual([])
  })

  it('catalog key 与运行时 key 一一对应', () => {
    expect(Object.keys(catalog).every((key) => key in flat)).toBe(true)
  })

  it('多语言目录条数一致', () => {
    if (locale !== 'en') expect(Object.keys(catalog).length).toBe(Object.keys(en).length)
  })
})
