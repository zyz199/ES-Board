// 一次性迁移：把「源文本 key」的翻译搬到「哈希 id key」上（Lingui 宏实际使用的 id）。
// 背景：catalog 早期从 vue-i18n 迁移而来，key 是源文本；而 Lingui v5 宏生成的 msgid 是源文本哈希。
// 现在让哈希 id 成为唯一权威 key，源文本 key 只保留宏/命令式调用都没引用到的孤儿条目。
import fs from 'node:fs'
import { generateMessageId } from '@lingui/message-utils/generateMessageId'

const LOCALES = ['en', 'zh-CN', 'ja']
const BACKUP = '/tmp/esking-i18n-backup'
const dir = 'src/locales'

for (const loc of LOCALES) {
  const origKeys = Object.keys(
    JSON.parse(fs.readFileSync(`${BACKUP}/${loc}/messages.json`, 'utf8')),
  )
  const origSet = new Set(origKeys)
  const cur = JSON.parse(fs.readFileSync(`${dir}/${loc}/messages.json`, 'utf8'))

  const out = {}
  // 1. 提取出来的新条目（哈希 id）先落位
  for (const [k, v] of Object.entries(cur)) {
    if (!origSet.has(k)) out[k] = v
  }

  let migrated = 0
  const dropped = []
  const kept = []
  // 2. 逐条处理原有源文本条目
  for (const k of origKeys) {
    const hash = generateMessageId(k)
    const srcEntry = cur[k] || {}
    if (out[hash]) {
      // 宏在用这条消息：把源文本条目的译文搬到哈希条目上
      if (srcEntry.translation) {
        out[hash].translation = srcEntry.translation
        migrated++
      }
      dropped.push(k)
    } else {
      // 没有任何 t 宏引用（孤儿），保留源文本 key
      out[k] = srcEntry
      kept.push(k)
    }
  }

  fs.writeFileSync(`${dir}/${loc}/messages.json`, JSON.stringify(out, null, 2) + '\n')
  console.log(
    `${loc}: 总 ${Object.keys(out).length} 条 | 迁移译文 ${migrated} 条 | 删除源文本 key ${dropped.length} 条 | 保留孤儿 ${kept.length} 条`,
  )
  if (kept.length) console.log(`  孤儿：${kept.map((k) => JSON.stringify(k)).join(', ')}`)
}
