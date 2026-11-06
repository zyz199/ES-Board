import { generateMessageId } from '@lingui/message-utils/generateMessageId'

/**
 * Lingui 结构化 catalog → 运行时扁平格式 {msgid: translation}
 *
 * catalog 的 key 就是 Lingui 宏（t`...`）生成的 msgid（源文本的 sha256 前 6 位 base64），
 * 由 `pnpm i18n:extract` 维护；每条还带 message（英文原文）与 origin（引用位置）。
 *
 * 取值优先级：translation → message → id
 *   - translation 为空即「未翻译」，回落到 message（英文原文）。**不能回落到 id**：
 *     生产构建会剥离宏输出里的 message 字段，若目录里也没有，i18n 会把哈希 id 当作
 *     文案渲染出来（页面出现 XGrAzU 这类乱码）——这个坑已经踩过两次。
 *   - 极少数只以源文本为 key 的条目是历史遗留（extract 已标记 obsolete、无宏引用），
 *     直接取 id 即源文本本身。
 *
 */
export interface CatalogEntry {
  translation?: string
  message?: string
}

export function flattenCatalog(catalog: Record<string, CatalogEntry>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [id, entry] of Object.entries(catalog)) {
    const value = entry?.translation || entry?.message
    out[id] = value || id
  }
  // 兼容兜底：若代码里还有 i18n._('源文本') 这种按源文本取词的写法，
  // 把源文本条目同时注册到它的哈希 id 上（不覆盖已存在的条目）。
  for (const [id, entry] of Object.entries(catalog)) {
    const value = entry?.translation || entry?.message
    if (!value) continue
    const hashId = generateMessageId(id)
    if (!(hashId in out)) out[hashId] = value
  }
  return out
}
