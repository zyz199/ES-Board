import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectLocale, SUPPORTED } from '../../src/i18n'

// ja（日语）已下线，这里锁住下线的行为，避免后续误加回目录/选项
describe('detectLocale', () => {
  afterEach(() => vi.unstubAllGlobals())

  const localeFor = (language: string) => {
    vi.stubGlobal('navigator', { language })
    return detectLocale()
  }

  it('中文系统 → zh-CN', () => {
    expect(localeFor('zh-CN')).toBe('zh-CN')
    expect(localeFor('zh-Hant')).toBe('zh-CN')
  })

  it('英文系统 → en', () => {
    expect(localeFor('en-US')).toBe('en')
  })

  it('日语系统已下线，回落 en', () => {
    expect(localeFor('ja-JP')).toBe('en')
  })

  it('未提供 navigator.language 时回落 zh-CN', () => {
    vi.stubGlobal('navigator', {})
    expect(detectLocale()).toBe('zh-CN')
  })

  it('SUPPORTED 只含 zh-CN 与 en', () => {
    expect(SUPPORTED).toEqual(['zh-CN', 'en'])
  })
})
